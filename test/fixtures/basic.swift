#!/usr/bin/env swift
import Foundation
import SwiftUI

/// A small oven timer. This doc comment says class and "string" but stays a comment.
// One line comment: func let if "quotes"
/* A block comment /* with a nested one */ that is still a comment */

let maxTrays = 1_000
let mask = 0xFF_FF
let flags = 0b1010
let perms = 0o755
let ratio = 1.5e10
let tiny = 2.5E-3
let hexFloat = 0x1.8p3
let hexExp = 0xAp-2
let pair = (3, (4, 5))
let inner = pair.1.0
let range = 1...10
let half = 0..<5

#if DEBUG
let mode = "debug"
#elseif os(macOS)
let mode = "mac"
#else
let mode = "release"
#endif

protocol Baked {
    var name: String { get }
    var heat: Int { get set }
    mutating func cool()
}

struct Loaf: Baked, Hashable {
    let name: String
    var heat: Int = 200
    private(set) var slices = 8

    mutating func cool() {
        heat -= 20
    }
}

enum Step {
    case knead
    case rest(minutes: Int)
    indirect case then(Step, Step)
}

@MainActor
final class Oven: ObservableObject {
    @Published var trays: [Loaf] = []
    @State private var open = false
    weak var door: AnyObject?
    lazy var label: String = "Oven number \(trays.count)"

    var count: Int {
        get { trays.count }
        set(newValue) { print(newValue) }
    }

    var temperature: Int = 0 {
        willSet { print("going to \(newValue)") }
        didSet {
            if temperature > 300 { temperature = 300 }
        }
    }

    static let shared = Oven()

    required init() {}

    convenience init?(name: String) {
        self.init()
    }

    deinit {
        print("oven closed")
    }

    // A variable named get, set, some, any and async stays plain.
    func describe() -> String {
        let get = 1
        let set = 2
        let some = 3
        let any = 4
        let async = 5
        let actor = 6
        let await = 7
        return "\(get + set + some + any + async + actor + await)"
    }

    func bake(_ loaf: Loaf, for minutes: Int) async throws -> Loaf {
        try await Task.sleep(nanoseconds: 1_000)
        async let extra = Task.sleep(nanoseconds: 5)
        _ = try await extra
        return loaf
    }

    @objc func ring(_ sender: Any?) {}

    func shapes() -> some View {
        Text("Ready")
    }

    func pick(_ item: any Baked, from list: [any Baked]) -> Int {
        return list.count
    }

    subscript(index: Int) -> Loaf {
        trays[index]
    }
}

actor Counter {
    private var total = 0

    func add(_ amount: Int) -> Int {
        total += amount
        return total
    }
}

extension Oven {
    func quick() -> [String] {
        let names = trays.map { $0.name }
        let sorted = trays.sorted { $0.heat < $1.heat }
        return names + sorted.map(\.name)
    }
}

func `class`(_ value: Int) -> Int {
    return value
}

func greet(name: String, times: Int?) -> String {
    let plain = "Hello, \(name)!"
    let nested = "Total: \(names.map { "<\($0)>" }.joined(separator: ", ")) done"
    let math = "Sum: \((1 + 2) * 3) and \(max(1, 2))"
    let escapes = "tab\t quote\" slash\\ unicode\u{1F600} backslash-paren \\(not code)"
    let multi = """
        Line one with \(name)
        Line two with "quotes" and ""double"" quotes
        A \
        continued line
        """
    let raw = #"raw \(not code) and \#(name) and "quotes""#
    let raw2 = ##"two hashes "# still raw \##(name)"##
    let rawMulti = #"""
        raw block \(literal)
        """#
    let escapedQuotes = """
        a \""" is escaped
        """
    switch times {
    case .some(let count) where count > 1:
        return plain + String(count)
    case .none:
        return multi
    default:
        return nested + math + escapes + raw + raw2 + rawMulti + escapedQuotes
    }
}

func run() {
    #if os(iOS)
    print("phone")
    #endif
    if #available(macOS 13, *) {
        print("new")
    }
    let action = #selector(Oven.ring(_:))
    let line = #line
    do {
        let result = try compute()
        print(result)
    } catch let error as NSError {
        print(error)
    } catch {
        print("failed")
    }
    guard let first = Optional(1) else { return }
    for await item in stream {
        defer { print(item) }
    }
    outer: for i in 0..<3 {
        if i == 1 { continue outer }
    }
}
