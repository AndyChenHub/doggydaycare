import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let defaultsKey = "com.pawsandplay.nativeStorage.v1"

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    private var storageFileURL: URL? {
        let fm = FileManager.default
        if let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fm.urls(for: .documentDirectory, in: .userDomainMask).first {
            let dir = base.appendingPathComponent("PawsAndPlay", isDirectory: true)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir.appendingPathComponent("save_storage.json")
        }
        return nil
    }

    private func loadNativeStorage() -> [String: String] {
        var result: [String: String] = [:]
        if let dict = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String] {
            for (k, v) in dict { result[k] = v }
        }
        if let url = storageFileURL,
           let data = try? Data(contentsOf: url),
           let fileDict = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            for (k, v) in fileDict { result[k] = v }
        }
        return result
    }

    private func saveNativeStorage(_ storage: [String: String]) {
        UserDefaults.standard.set(storage, forKey: defaultsKey)
        UserDefaults.standard.synchronize()
        if let url = storageFileURL,
           let data = try? JSONSerialization.data(withJSONObject: storage, options: []) {
            try? data.write(to: url, options: .atomic)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 47.0 / 255.0, green: 74.0 / 255.0, blue: 44.0 / 255.0, alpha: 1.0)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let contentController = WKUserContentController()
        contentController.add(self, name: "pawsStorage")

        let existing = loadNativeStorage()
        if let jsonData = try? JSONSerialization.data(withJSONObject: existing, options: []),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
            let bootstrapJS = """
            (function() {
              try {
                var data = \(jsonStr);
                window.__PAWS_NATIVE_STORAGE__ = data;
                for (var k in data) {
                  if (typeof data[k] !== 'string') continue;
                  var cur = null;
                  try { cur = localStorage.getItem(k); } catch (e) {}
                  if (!cur) {
                    try { localStorage.setItem(k, data[k]); } catch (e) {}
                  } else if (k === 'pawsPlaySave_v2' || k === 'pawsPlaySave_backup') {
                    try {
                      var curObj = JSON.parse(cur);
                      var natObj = JSON.parse(data[k]);
                      var curTs = (curObj && (curObj.savedAt || curObj.created || 0)) || 0;
                      var natTs = (natObj && (natObj.savedAt || natObj.created || 0)) || 0;
                      if (natTs >= curTs) localStorage.setItem(k, data[k]);
                    } catch (e) {
                      try { localStorage.setItem(k, data[k]); } catch (e2) {}
                    }
                  }
                }
              } catch (e) {}
            })();
            """
            let script = WKUserScript(source: bootstrapJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            contentController.addUserScript(script)
        }
        config.userContentController = contentController

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = true
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.delaysContentTouches = false
        webView.navigationDelegate = self
        view.addSubview(webView)

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.willTerminateNotification, object: nil)

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            let wwwDir = indexURL.deletingLastPathComponent()
            webView.loadFileURL(indexURL, allowingReadAccessTo: wwwDir)
        }
    }

    @objc private func flushWebViewSave() {
        webView?.evaluateJavaScript("if (typeof saveGame === 'function') saveGame();", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pawsStorage", let body = message.body as? [String: Any] else { return }
        var store = loadNativeStorage()
        if let key = body["key"] as? String, let val = body["value"] as? String {
            store[key] = val
        }
        if let batch = body["batch"] as? [String: String] {
            for (k, v) in batch { store[k] = v }
        }
        if let removeKeys = body["remove"] as? [String] {
            for k in removeKeys { store.removeValue(forKey: k) }
        }
        saveNativeStorage(store)
    }
}
