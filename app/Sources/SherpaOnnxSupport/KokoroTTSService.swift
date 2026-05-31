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

    public init(url: URL, duration: TimeInterval) {
        self.url = url
        self.duration = duration
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

private final class KokoroTTSEngine {
    private let cStrings = CStringStore()
    private let tts: OpaquePointer

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
