#if os(iOS)
import CSherpaOnnx
import Foundation

public actor KokoroTTSService {
    private var engine: KokoroTTSEngine?
    private var engineKey: EngineKey?

    public init() {}

    public func prepare(modelDirectory: URL) throws {
        _ = try engine(for: modelDirectory)
    }

    public func render(text: String, modelDirectory: URL, speakerID: Int32, rate: Double) throws -> KokoroRenderedAudio {
        let engine = try engine(for: modelDirectory)
        return try engine.render(text: text, speakerID: speakerID, rate: rate)
    }

    public func stream(text: String, modelDirectory: URL, speakerID: Int32, rate: Double) throws -> KokoroAudioStream {
        let engine = try engine(for: modelDirectory)
        return engine.stream(text: text, speakerID: speakerID, rate: rate)
    }

    private func engine(for modelDirectory: URL) throws -> KokoroTTSEngine {
        let key = EngineKey(modelDirectory: modelDirectory.path)
        if engineKey != key {
            engine = try KokoroTTSEngine(modelDirectory: modelDirectory)
            engineKey = key
        }

        guard let engine else {
            throw KokoroTTSError.engineUnavailable
        }

        return engine
    }
}

public struct KokoroRenderedAudio: Sendable {
    public let url: URL
    public let duration: TimeInterval
    public let wordTimings: [KokoroWordTiming]

    public init(url: URL, duration: TimeInterval, wordTimings: [KokoroWordTiming] = []) {
        self.url = url
        self.duration = duration
        self.wordTimings = wordTimings
    }
}

public struct KokoroWordTiming: Codable, Sendable {
    public let text: String
    public let start: Double
    public let end: Double

    public init(text: String, start: Double, end: Double) {
        self.text = text
        self.start = start
        self.end = end
    }
}

public struct KokoroAudioChunk: Sendable {
    public let samples: [Float]
    public let progress: Float

    public init(samples: [Float], progress: Float) {
        self.samples = samples
        self.progress = progress
    }
}

public struct KokoroAudioStream: Sendable {
    public let sampleRate: Int32
    public let chunks: AsyncThrowingStream<KokoroAudioChunk, Error>
    public let renderedAudio: Task<KokoroRenderedAudio, Error>
    public let cancel: @Sendable () -> Void

    public init(
        sampleRate: Int32,
        chunks: AsyncThrowingStream<KokoroAudioChunk, Error>,
        renderedAudio: Task<KokoroRenderedAudio, Error>,
        cancel: @escaping @Sendable () -> Void
    ) {
        self.sampleRate = sampleRate
        self.chunks = chunks
        self.renderedAudio = renderedAudio
        self.cancel = cancel
    }
}

public enum KokoroTTSError: LocalizedError {
    case missingModelFile(String)
    case engineUnavailable
    case generationFailed
    case emptyAudio
    case writeFailed

    public var errorDescription: String? {
        switch self {
        case .missingModelFile(let name):
            return "Kokoro TTS is missing \(name)."
        case .engineUnavailable:
            return "Kokoro TTS could not start."
        case .generationFailed:
            return "Kokoro TTS could not generate this paragraph."
        case .emptyAudio:
            return "Kokoro TTS returned no audio."
        case .writeFailed:
            return "Kokoro TTS could not prepare the audio file."
        }
    }
}

private struct EngineKey: Equatable {
    let modelDirectory: String
}

private final class KokoroTTSEngine: @unchecked Sendable {
    private let cStrings = CStringStore()
    private let tts: OpaquePointer
    private let generationLock = NSLock()

    init(modelDirectory: URL) throws {
        let requiredFiles = [
            "model.onnx",
            "voices.bin",
            "tokens.txt",
            "espeak-ng-data"
        ]

        for file in requiredFiles {
            let url = modelDirectory.appendingPathComponent(file)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw KokoroTTSError.missingModelFile(file)
            }
        }

        var config = SherpaOnnxOfflineTtsConfig()
        config.model.num_threads = Int32(min(4, max(2, ProcessInfo.processInfo.activeProcessorCount - 1)))
        config.model.debug = 0
        config.model.provider = cStrings.add("cpu")
        config.model.kokoro.model = cStrings.add(modelDirectory.appendingPathComponent("model.onnx").path)
        config.model.kokoro.voices = cStrings.add(modelDirectory.appendingPathComponent("voices.bin").path)
        config.model.kokoro.tokens = cStrings.add(modelDirectory.appendingPathComponent("tokens.txt").path)
        config.model.kokoro.data_dir = cStrings.add(modelDirectory.appendingPathComponent("espeak-ng-data").path)
        config.model.kokoro.lexicon = cStrings.add(Self.lexiconPaths(in: modelDirectory))
        config.model.kokoro.length_scale = 1.0
        config.max_num_sentences = 1
        config.silence_scale = 0.12

        guard let created = withUnsafePointer(to: &config, { SherpaOnnxCreateOfflineTts($0) }) else {
            throw KokoroTTSError.engineUnavailable
        }
        tts = created
    }

    private static func lexiconPaths(in modelDirectory: URL) -> String {
        [
            "lexicon-us-en.txt",
            "lexicon-gb-en.txt",
            "lexicon-zh.txt"
        ]
        .map { modelDirectory.appendingPathComponent($0).path }
        .filter { FileManager.default.fileExists(atPath: $0) }
        .joined(separator: ",")
    }

    deinit {
        SherpaOnnxDestroyOfflineTts(tts)
    }

    func render(text: String, speakerID: Int32, rate: Double) throws -> KokoroRenderedAudio {
        generationLock.lock()
        defer { generationLock.unlock() }

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("illume-kokoro-tts-\(UUID().uuidString)")
            .appendingPathExtension("wav")
        let safeRate = Float(min(2.0, max(0.7, rate)))

        let audio = text.withCString { textPointer in
            var generationConfig = SherpaOnnxGenerationConfig()
            generationConfig.silence_scale = 0.12
            generationConfig.speed = safeRate
            generationConfig.sid = speakerID

            return withUnsafePointer(to: &generationConfig) { configPointer in
                SherpaOnnxOfflineTtsGenerateWithConfig(
                    tts,
                    textPointer,
                    configPointer,
                    nil,
                    nil
                )
            }
        }

        guard let audio else {
            throw KokoroTTSError.generationFailed
        }
        defer {
            SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
        }

        guard audio.pointee.n > 0, audio.pointee.samples != nil else {
            throw KokoroTTSError.emptyAudio
        }

        let ok = SherpaOnnxWriteWave(
            audio.pointee.samples,
            audio.pointee.n,
            audio.pointee.sample_rate,
            outputURL.path
        )
        guard ok == 1 else {
            throw KokoroTTSError.writeFailed
        }

        let duration = Double(audio.pointee.n) / Double(audio.pointee.sample_rate)
        return KokoroRenderedAudio(url: outputURL, duration: duration)
    }

    func stream(text: String, speakerID: Int32, rate: Double) -> KokoroAudioStream {
        let sampleRate = SherpaOnnxOfflineTtsSampleRate(tts)
        let context = KokoroStreamingContext()
        let chunks = AsyncThrowingStream<KokoroAudioChunk, Error> { continuation in
            context.setContinuation(continuation)
            continuation.onTermination = { @Sendable _ in
                context.cancel()
            }
        }
        let renderedAudio = Task.detached(priority: .userInitiated) { [self] in
            try generateStreamingAudio(text: text, speakerID: speakerID, rate: rate, context: context)
        }

        return KokoroAudioStream(
            sampleRate: sampleRate,
            chunks: chunks,
            renderedAudio: renderedAudio,
            cancel: { context.cancel() }
        )
    }

    private func generateStreamingAudio(
        text: String,
        speakerID: Int32,
        rate: Double,
        context: KokoroStreamingContext
    ) throws -> KokoroRenderedAudio {
        generationLock.lock()
        defer { generationLock.unlock() }

        let safeRate = Float(min(2.0, max(0.7, rate)))
        let audio = text.withCString { textPointer in
            var generationConfig = SherpaOnnxGenerationConfig()
            generationConfig.silence_scale = 0.12
            generationConfig.speed = safeRate
            generationConfig.sid = speakerID

            return withUnsafePointer(to: &generationConfig) { configPointer in
                withExtendedLifetime(context) {
                    SherpaOnnxOfflineTtsGenerateWithConfig(
                        tts,
                        textPointer,
                        configPointer,
                        kokoroStreamingProgressCallback,
                        Unmanaged.passUnretained(context).toOpaque()
                    )
                }
            }
        }

        guard !context.isCancelled else {
            throw CancellationError()
        }
        guard let audio else {
            context.finish(throwing: KokoroTTSError.generationFailed)
            throw KokoroTTSError.generationFailed
        }
        defer {
            SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
        }

        guard audio.pointee.n > 0, audio.pointee.samples != nil else {
            context.finish(throwing: KokoroTTSError.emptyAudio)
            throw KokoroTTSError.emptyAudio
        }

        do {
            let renderedAudio = try writeRenderedAudio(audio)
            context.finish()
            return renderedAudio
        } catch {
            context.finish(throwing: error)
            throw error
        }
    }

    private func writeRenderedAudio(_ audio: UnsafePointer<SherpaOnnxGeneratedAudio>) throws -> KokoroRenderedAudio {
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("illume-kokoro-tts-\(UUID().uuidString)")
            .appendingPathExtension("wav")
        let ok = SherpaOnnxWriteWave(
            audio.pointee.samples,
            audio.pointee.n,
            audio.pointee.sample_rate,
            outputURL.path
        )
        guard ok == 1 else {
            throw KokoroTTSError.writeFailed
        }

        let duration = Double(audio.pointee.n) / Double(audio.pointee.sample_rate)
        return KokoroRenderedAudio(url: outputURL, duration: duration)
    }
}

private let kokoroStreamingProgressCallback: SherpaOnnxGeneratedAudioProgressCallbackWithArg = { samples, n, progress, arg in
    guard let arg else { return 0 }
    let context = Unmanaged<KokoroStreamingContext>.fromOpaque(arg).takeUnretainedValue()
    return context.receive(samples: samples, count: n, progress: progress)
}

private final class KokoroStreamingContext: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncThrowingStream<KokoroAudioChunk, Error>.Continuation?
    private var cancelled = false
    private var deliveredSampleCount = 0

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func setContinuation(_ continuation: AsyncThrowingStream<KokoroAudioChunk, Error>.Continuation) {
        lock.lock()
        self.continuation = continuation
        let shouldFinish = cancelled
        lock.unlock()

        if shouldFinish {
            continuation.finish()
        }
    }

    func receive(samples: UnsafePointer<Float>?, count: Int32, progress: Float) -> Int32 {
        guard !isCancelled else { return 0 }
        guard let samples, count > 0 else { return 1 }

        let totalSampleCount = Int(count)
        lock.lock()
        let start = deliveredSampleCount
        guard totalSampleCount > start else {
            lock.unlock()
            return isCancelled ? 0 : 1
        }
        deliveredSampleCount = totalSampleCount
        let continuation = self.continuation
        lock.unlock()

        let copiedSamples = Array(
            UnsafeBufferPointer(
                start: samples.advanced(by: start),
                count: totalSampleCount - start
            )
        )
        continuation?.yield(KokoroAudioChunk(samples: copiedSamples, progress: progress))
        return isCancelled ? 0 : 1
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.finish()
    }

    func finish() {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.finish()
    }

    func finish(throwing error: Error) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.finish(throwing: error)
    }
}

private final class CStringStore {
    private var pointers: [UnsafeMutablePointer<CChar>] = []

    func add(_ value: String) -> UnsafePointer<CChar> {
        let pointer = strdup(value)!
        pointers.append(pointer)
        return UnsafePointer(pointer)
    }

    deinit {
        for pointer in pointers {
            free(pointer)
        }
    }
}
#endif
