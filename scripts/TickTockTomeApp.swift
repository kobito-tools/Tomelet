import Cocoa
import WebKit

private let localHosts: Set<String> = ["localhost", "127.0.0.1"]

@main
struct TickTockTomeApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var launcher: Process?
    private var isStopping = false

    private var projectRoot: URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "TickTockTomeProjectRoot") as? String else { fatalError("TickTockTomeProjectRoot is missing") }
        return URL(fileURLWithPath: value, isDirectory: true)
    }

    private var nodeExecutable: URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "TickTockTomeNodePath") as? String else { fatalError("TickTockTomeNodePath is missing") }
        return URL(fileURLWithPath: value)
    }

    // PC固有設定（config/setting.json）。ポートと表示言語を読む。
    private var savedSetting: [String: Any] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let support = home.appendingPathComponent("Library/Application Support")
        // 旧名DailyLogの個人データ領域は、新しい名前の領域が無い限りそのまま使う（scripts/settings.jsと同じ規則）。
        let current = support.appendingPathComponent("TickTockTome")
        let legacy = support.appendingPathComponent("DailyLog")
        let dataDirectory = !FileManager.default.fileExists(atPath: current.path) && FileManager.default.fileExists(atPath: legacy.path) ? legacy : current
        let setting = dataDirectory.appendingPathComponent("config/setting.json")
        guard let data = try? Data(contentsOf: setting), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    private var serverURL: URL {
        var port = 3174
        if let savedPort = savedSetting["port"] as? Int, (1024...65535).contains(savedPort) { port = savedPort }
        return URL(string: "http://localhost:\(port)/")!
    }

    // 画面右上で選んだ表示言語に合わせて、メニューやダイアログの文言を切り替える。
    private func text(_ japanese: String, _ english: String) -> String {
        (savedSetting["language"] as? String) == "en" ? english : japanese
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(openTimerCompletion), name: Notification.Name("TickTockTomeOpenTimerCompletion"), object: nil)
        configureMenu()
        configureWindow()
        startServer()
    }
    @objc private func openTimerCompletion() {
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "timerComplete", value: "1")]
        if let url = components.url { webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)) }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { stopServer() }

    private func configureMenu() {
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        mainMenu.addItem(applicationItem)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: text("Tomeletについて", "About Tomelet"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        applicationMenu.addItem(NSMenuItem.separator())
        applicationMenu.addItem(withTitle: text("Tomeletを終了", "Quit Tomelet"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: text("編集", "Edit"))
        editMenu.addItem(withTitle: text("取り消す", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: text("やり直す", "Redo"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: text("カット", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: text("コピー", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: text("ペースト", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: text("すべてを選択", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        NSApplication.shared.mainMenu = mainMenu
    }

    private func configureWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Tomelet"
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func startServer() {
        let process = Process()
        let output = Pipe()
        process.executableURL = nodeExecutable
        process.arguments = [projectRoot.appendingPathComponent("scripts/launch.js").path, "--no-browser"]
        process.currentDirectoryURL = projectRoot
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { [weak self] completed in
            let message = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                guard let self, !self.isStopping else { return }
                if completed.terminationStatus == 0 {
                    self.webView.load(URLRequest(url: self.serverURL, cachePolicy: .reloadIgnoringLocalCacheData))
                } else { self.showLaunchError(message) }
            }
        }
        do { try process.run(); launcher = process }
        catch { showLaunchError(error.localizedDescription) }
    }

    private func stopServer() {
        guard !isStopping else { return }
        isStopping = true
        launcher?.terminate()
        let process = Process()
        process.executableURL = nodeExecutable
        process.arguments = [projectRoot.appendingPathComponent("scripts/stop.js").path]
        process.currentDirectoryURL = projectRoot
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch { /* サーバーが未起動なら終了処理は不要 */ }
    }

    private func showLaunchError(_ detail: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = text("Tomeletを起動できませんでした", "Couldn't start Tomelet")
        let message = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        alert.informativeText = message.isEmpty ? text("初期設定とNode.jsを確認してください。", "Check the setup and Node.js.") : message
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }

    // 表示言語を切り替えると画面が読み込み直されるので、そのたびにメニューも作り直す。
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        configureMenu()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if let host = url.host, localHosts.contains(host) { decisionHandler(.allow); return }
        if ["https", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !localHosts.contains(url.host ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    // WKWebViewは、これらを実装しないとwindow.alert／confirm／promptを表示せず、confirmは常にfalseになる。
    private func presentAlert(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window { alert.beginSheetModal(for: window, completionHandler: completion) }
        else { completion(alert.runModal()) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        presentAlert(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: text("キャンセル", "Cancel"))
        presentAlert(alert) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: text("キャンセル", "Cancel"))
        presentAlert(alert) { response in completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
}
