import Foundation
import Vision
import ImageIO

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else { fatalError("Usage: ocr output.json image...") }
let output = args[0]
var pages: [[String: Any]] = []
for filename in args.dropFirst() {
    let url = URL(fileURLWithPath: filename)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("Invalid image") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    let start = Date()
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let ms = Date().timeIntervalSince(start) * 1000
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
        guard let best = observation.topCandidates(1).first else { continue }
        let b = observation.boundingBox
        lines.append(["text": best.string, "confidence": best.confidence, "bounds": [b.minX * Double(image.width), (1-b.maxY) * Double(image.height), b.maxX * Double(image.width), (1-b.minY) * Double(image.height)]])
    }
    pages.append(["file": filename, "width": image.width, "height": image.height, "recognitionMs": ms, "revision": request.revision, "lines": lines])
    print("OCR \(url.lastPathComponent): \(lines.count) lines, \(Int(ms)) ms")
}
let data = try JSONSerialization.data(withJSONObject: ["engine": "Apple Vision VNRecognizeTextRequest", "languages": ["zh-Hans", "en-US"], "languageCorrection": false, "pages": pages], options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: output))
