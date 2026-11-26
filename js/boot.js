'use strict';
/* ============================================================================================
   boot.js — Over-The-Air (OTA) GitHub Update Bootstrapper for Paws & Play (iOS IPA & Web)
   - Loads OTA-updated CSS & JS fetched from https://raw.githubusercontent.com/AndyChenHub/doggydaycare/main/
   - Persists updates across iPhone app restarts via both localStorage and native pawsStorage
   - Automatically falls back to bundled IPA assets if no OTA update is active or if a newer IPA is installed
   ============================================================================================ */
(function () {
  var BUNDLED_VER = 33;
  var DEFAULT_SCRIPTS = [
    'js/config.js',
    'js/data.js',
    'js/breeds.js',
    'js/sound.js',
    'js/music.js',
    'js/dogart.js',
    'js/dogportrait.js',
    'js/people.js',
    'js/objects_a.js',
    'js/objects_b.js',
    'js/worldart.js',
    'js/shopart.js',
    'js/game.js',
    'js/render.js',
    'js/multiplayer.js',
    'js/minigames.js',
    'js/minigames_extra.js',
    'js/ui.js'
  ];

  window.__PAWS_BUNDLED_VER__ = BUNDLED_VER;
  window.__PAWS_DEFAULT_SCRIPTS__ = DEFAULT_SCRIPTS;

  function otaGet(key) {
    var val = null;
    try { val = localStorage.getItem(key); } catch (e) {}
    if (!val && typeof window !== 'undefined' && window.__PAWS_NATIVE_STORAGE__ && typeof window.__PAWS_NATIVE_STORAGE__[key] === 'string') {
      val = window.__PAWS_NATIVE_STORAGE__[key];
      try { localStorage.setItem(key, val); } catch (e2) {}
    }
    return val;
  }

  function otaRemoveAll() {
    var keys = ['pawsPlayOTA_meta', 'pawsPlayOTA_css'];
    for (var i = 0; i < DEFAULT_SCRIPTS.length; i++) keys.push('pawsPlayOTA_' + DEFAULT_SCRIPTS[i]);
    try {
      for (var k = 0; k < localStorage.length; k++) {
        var lk = localStorage.key(k);
        if (lk && lk.indexOf('pawsPlayOTA_') === 0 && keys.indexOf(lk) < 0) keys.push(lk);
      }
    } catch (e) {}
    for (var j = 0; j < keys.length; j++) {
      try { localStorage.removeItem(keys[j]); } catch (e2) {}
      try {
        if (window.__PAWS_NATIVE_STORAGE__) delete window.__PAWS_NATIVE_STORAGE__[keys[j]];
      } catch (e3) {}
    }
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pawsStorage) {
        window.webkit.messageHandlers.pawsStorage.postMessage({ remove: keys });
      }
    } catch (e4) {}
  }

  window.__PAWS_CLEAR_OTA__ = otaRemoveAll;

  var metaRaw = otaGet('pawsPlayOTA_meta');
  var meta = null;
  if (metaRaw) {
    try { meta = JSON.parse(metaRaw); } catch (e) { meta = null; }
  }

  // If the user installed a newer IPA than the cached OTA bundle, clear the older OTA cache
  if (meta && typeof meta.bundledVer === 'number' && BUNDLED_VER > meta.bundledVer && BUNDLED_VER > (Number(meta.ver) || 0)) {
    otaRemoveAll();
    meta = null;
  }

  var useOTA = false;
  var scriptsToLoad = DEFAULT_SCRIPTS;
  if (meta && Array.isArray(meta.scripts) && meta.scripts.length >= 10) {
    var allPresent = true;
    for (var si = 0; si < meta.scripts.length; si++) {
      var codeCheck = otaGet('pawsPlayOTA_' + meta.scripts[si]);
      if (!codeCheck || codeCheck.length < 20) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      useOTA = true;
      scriptsToLoad = meta.scripts;
    }
  }

  if (useOTA) {
    try {
      window.__PAWS_ACTIVE_OTA__ = meta;
      var otaCss = otaGet('pawsPlayOTA_css');
      if (otaCss && otaCss.length > 50) {
        var st = document.createElement('style');
        st.id = 'paws-ota-style';
        st.textContent = otaCss;
        (document.head || document.documentElement).appendChild(st);
      }
      for (var i = 0; i < scriptsToLoad.length; i++) {
        var sp = scriptsToLoad[i];
        var jsCode = otaGet('pawsPlayOTA_' + sp);
        var sc = document.createElement('script');
        sc.setAttribute('data-ota-src', sp);
        sc.text = jsCode + '\n//# sourceURL=' + sp;
        (document.head || document.documentElement).appendChild(sc);
      }
      return;
    } catch (err) {
      console.error('OTA boot error, reverting to bundled assets:', err);
      otaRemoveAll();
      window.__PAWS_ACTIVE_OTA__ = null;
    }
  }

  // Default: load bundled scripts synchronously
  for (var bi = 0; bi < DEFAULT_SCRIPTS.length; bi++) {
    document.write('<script src="' + DEFAULT_SCRIPTS[bi] + '?v=' + BUNDLED_VER + '"><\/script>');
  }
})();
