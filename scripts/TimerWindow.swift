import Cocoa
import Foundation

@main struct TimerApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = TimerDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
final class TimerDelegate: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    let value = NSTextField(labelWithString: "--:--:--")
    let detail = NSTextField(labelWithString: "Tomelet")
    let completeButton = NSButton(title: TimerText.done, target: nil, action: nil)
    let offButton = NSButton(title: TimerText.pinnedOff, target: nil, action: nil)
    var polling = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = NSPanel(contentRect: NSRect(x: 18, y: 18, width: 300, height: 150), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Tomelet Timer"
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        if let screen = NSScreen.main { panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.minX + 18, y: screen.visibleFrame.minY + 18)) }
        value.frame = NSRect(x: 18, y: 88, width: 264, height: 42)
        value.font = NSFont.monospacedDigitSystemFont(ofSize: 34, weight: .semibold)
        detail.frame = NSRect(x: 18, y: 55, width: 264, height: 26)
        detail.lineBreakMode = .byTruncatingTail
        panel.contentView?.addSubview(value)
        panel.contentView?.addSubview(detail)
        completeButton.frame = NSRect(x: 18, y: 14, width: 126, height: 32)
        completeButton.target = self; completeButton.action = #selector(openCompletion)
        completeButton.isHidden = true
        offButton.frame = NSRect(x: 156, y: 14, width: 126, height: 32)
        offButton.target = self; offButton.action = #selector(turnOff)
        panel.contentView?.addSubview(completeButton); panel.contentView?.addSubview(offButton)
        panel.orderFrontRegardless()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
        refresh()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    @objc func turnOff() { NSApplication.shared.terminate(nil) }
    @objc func openCompletion() {
        DistributedNotificationCenter.default().post(name: Notification.Name("TickTockTomeOpenTimerCompletion"), object: nil)
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "local.ticktocktome.desktop").first { app.activate(options: [.activateAllWindows]) }
        else if CommandLine.arguments.count > 1, let port=Int(CommandLine.arguments[1]), let url=URL(string:"http://127.0.0.1:\(port)/?timerComplete=1") { NSWorkspace.shared.open(url) }
    }
    func refresh() {
        guard !polling, CommandLine.arguments.count > 1, let port = Int(CommandLine.arguments[1]), (1024...65535).contains(port) else { return }
        polling = true
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/v1/timer")!)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.polling = false
                guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { self.detail.stringValue = TimerText.offline; return }
                let active = json["active"] as? [String: Any]
                let upcoming = json["upcoming"] as? [String: Any]
                self.completeButton.isHidden = active == nil
                if let item = active ?? upcoming, let time = item[active == nil ? "startTime" : "targetEndTime"] as? String ?? item["endTime"] as? String {
                    let parts = time.split(separator: ":").compactMap { Int($0) }
                    if parts.count == 2 {
                        let now = Date(), cal = Calendar.current
                        let current = cal.component(.hour, from: now) * 3600 + cal.component(.minute, from: now) * 60 + cal.component(.second, from: now)
                        let seconds = max(0, parts[0] * 3600 + parts[1] * 60 - current)
                        self.value.stringValue = String(format: "%02d:%02d:%02d", seconds / 3600, seconds % 3600 / 60, seconds % 60)
                    }
                    self.detail.stringValue = (active == nil ? TimerText.next : TimerText.running) + (item["action"] as? String ?? "")
                } else { self.value.stringValue = json["localTime"] as? String ?? "--:--:--"; self.detail.stringValue = "LOCAL TIME" }
            }
        }.resume()
    }
}

// 起動時の2番目の引数で表示言語を受け取る（"en" なら英語）。
enum TimerText {
    static let english = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "en"
    static let done = english ? "Done" : "完了"
    static let pinnedOff = english ? "Unpin" : "常駐OFF"
    static let offline = english ? "Can't connect to Tomelet" : "Tomeletに接続できません"
    static let next = english ? "Next | " : "次｜"
    static let running = english ? "Running | " : "実行中｜"
}
