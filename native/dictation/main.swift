// elastic-dictation: the composer's microphone, transcribed on this Mac.
//
// In:  raw 16 kHz mono signed 16-bit little-endian PCM on stdin. End of input
//      is the end of the dictation.
// Out: one JSON object per line on stdout:
//        {"type":"preparing"}                     the language's model is being installed
//        {"type":"listening","locale":"en_US"}    ready for audio
//        {"type":"text","text":"…"}               everything heard so far, settled and not
//        {"type":"done","text":"…"}               the settled transcript, after end of input
//        {"type":"error","code":"…","message":"…"}
//
// Apple's SpeechAnalyzer (macOS 26) runs on device and needs no speech
// recognition authorization, so a helper with no Info.plist of its own can use
// it. The microphone is the app's: the renderer records (Chromium asks macOS
// for the permission) and main pipes the samples here (`src/main/dictation`).

import AVFoundation
import Foundation
import Speech

func emit(_ object: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["type": "error", "code": code, "message": message])
  exit(1)
}

/// `a` then `b`, with one space between them when neither brings its own.
func joined(_ a: String, _ b: String) -> String {
  if a.isEmpty { return b }
  if b.isEmpty || a.last!.isWhitespace || b.first!.isWhitespace { return a + b }
  return a + " " + b
}

@main
struct Dictation {
  static func main() async {
    setvbuf(stdout, nil, _IONBF, 0)
    guard #available(macOS 26.0, *) else {
      emit(["type": "error", "code": "unsupported", "message": "Dictation needs macOS 26 or later."])
      exit(2)
    }
    do {
      try await run()
    } catch {
      fail("failed", error.localizedDescription)
    }
  }

  @available(macOS 26.0, *)
  static func run() async throws {
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else {
      fail("locale", "Dictation does not support \(Locale.current.identifier) yet.")
    }
    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
    // The first dictation in a language installs its model, once, from Apple.
    if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      emit(["type": "preparing"])
      try await install.downloadAndInstall()
    }
    let source = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) ?? source
    let converter = target == source ? nil : AVAudioConverter(from: source, to: target)

    let (inputs, feed) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.start(inputSequence: inputs)

    // A final result settles a stretch of audio; a volatile one is the best guess at what follows.
    let results = Task { () throws -> String in
      var settled = ""
      for try await result in transcriber.results {
        let text = String(result.text.characters)
        if result.isFinal {
          settled = joined(settled, text)
          emit(["type": "text", "text": settled])
        } else {
          emit(["type": "text", "text": joined(settled, text)])
        }
      }
      return settled
    }

    emit(["type": "listening", "locale": locale.identifier])

    // stdin blocks, so it is read off the cooperative pool.
    let reading = Task.detached {
      let stdin = FileHandle.standardInput
      var carry = Data()
      while true {
        let chunk = stdin.availableData
        if chunk.isEmpty { break }
        carry.append(chunk)
        let usable = carry.count - carry.count % 2
        if usable == 0 { continue }
        let bytes = carry.prefix(usable)
        carry.removeFirst(usable)
        if let buffer = pcmBuffer(bytes, source: source, target: target, converter: converter) {
          feed.yield(AnalyzerInput(buffer: buffer))
        }
      }
      feed.finish()
    }
    await reading.value
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    let settled = try await results.value
    emit(["type": "done", "text": settled])
  }

  static func pcmBuffer(
    _ bytes: Data, source: AVAudioFormat, target: AVAudioFormat, converter: AVAudioConverter?
  ) -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(bytes.count / 2)
    guard let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: frames) else { return nil }
    input.frameLength = frames
    bytes.withUnsafeBytes { raw in
      if let base = raw.baseAddress { memcpy(input.int16ChannelData![0], base, bytes.count) }
    }
    guard let converter else { return input }
    let capacity = AVAudioFrameCount(Double(frames) * target.sampleRate / source.sampleRate) + 64
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
    var given = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return input
    }
    return error == nil ? output : nil
  }
}
