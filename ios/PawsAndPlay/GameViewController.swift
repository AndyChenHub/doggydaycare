import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let defaultsKey = "com.pawsandplay.nativeStorage.v1"

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

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
        let grassColor = UIColor(red: 93.0 / 255.0, green: 157.0 / 255.0, blue: 73.0 / 255.0, alpha: 1.0)
        view.backgroundColor = grassColor

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        let contentController = WKUserContentController()
        contentController.add(self, name: "pawsStorage")

        let existing = loadNativeStorage()
        if let jsonData = try? JSONSerialization.data(withJSONObject: existing, options: []) {
            let b64 = jsonData.base64EncodedString()
            let bootstrapJS = """
            (function() {
              try {
                var raw = atob("\(b64)");
                var bytes = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                var jsonText = new TextDecoder("utf-8").decode(bytes);
                var data = JSON.parse(jsonText);
                window.__PAWS_NATIVE_STORAGE__ = data;
                for (var k in data) {
                  if (typeof k !== 'string' || k.indexOf('pawsPlay') !== 0) continue;
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
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = true
        webView.backgroundColor = grassColor
        webView.scrollView.backgroundColor = grassColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.delaysContentTouches = false
        webView.navigationDelegate = self
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(flushWebViewSave), name: UIApplication.willTerminateNotification, object: nil)

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            let wwwDir = indexURL.deletingLastPathComponent()
            webView.loadFileURL(indexURL, allowingReadAccessTo: wwwDir)
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        webView?.frame = view.bounds
        webView?.evaluateJavaScript("if (typeof resizeView === 'function') resizeView();", completionHandler: nil)
    }

    @objc private func flushWebViewSave() {
        webView?.evaluateJavaScript("if (typeof saveGame === 'function') saveGame();", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.isFileURL {
            let bundlePath = Bundle.main.bundleURL.standardizedFileURL.path
            let targetPath = url.standardizedFileURL.path
            if targetPath.hasPrefix(bundlePath) {
                decisionHandler(.allow)
                return
            }
        }
        decisionHandler(.cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pawsStorage", let body = message.body as? [String: Any] else { return }
        var store = loadNativeStorage()
        if let key = body["key"] as? String,
           let val = body["value"] as? String,
           key.hasPrefix("pawsPlay"),
           key.count <= 64,
           val.utf8.count <= 524_288 {
            store[key] = val
        }
        if let batch = body["batch"] as? [String: String] {
            for (k, v) in batch where k.hasPrefix("pawsPlay") && k.count <= 64 && v.utf8.count <= 524_288 {
                store[k] = v
            }
        }
        if let removeKeys = body["remove"] as? [String] {
            for k in removeKeys where k.hasPrefix("pawsPlay") && k.count <= 64 {
                store.removeValue(forKey: k)
            }
        }
        saveNativeStorage(store)
    }
}
