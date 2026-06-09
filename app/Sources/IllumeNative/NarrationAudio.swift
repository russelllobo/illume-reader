#if os(iOS)
import Foundation

struct KokoroRenderedAudio: Sendable {
    let url: URL
    let duration: TimeInterval
    let wordTimings: [KokoroWordTiming]

    init(url: URL, duration: TimeInterval, wordTimings: [KokoroWordTiming] = []) {
        self.url = url
        self.duration = duration
        self.wordTimings = wordTimings
    }
}

struct KokoroWordTiming: Codable, Sendable {
    let text: String
    let start: Double
    let end: Double

    init(text: String, start: Double, end: Double) {
        self.text = text
        self.start = start
        self.end = end
    }
}
#endif
