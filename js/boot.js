// Keeps the page, its styles and its code on the same edition of the ledger.
//
// This little script is loaded first, with the edition in its address
// (js/boot.js?b=ledger-vN), so it always arrives fresh after an update, even
// when an older offline copy is still in charge of the other files. Once the
// page has loaded it checks that the styles and the code are the same edition
// as the page. If they aren't, the phone is mixing old and new files: it asks
// for the new offline copy, clears the old one, and reloads once.
(function () {
  var me = document.currentScript;
  var BUILD = "";
  try { BUILD = new URL(me.src).searchParams.get("b") || ""; } catch (e) { /* very old browser */ }
  if (!BUILD || !("serviceWorker" in navigator)) return;

  var reloaded = false;
  function reloadOnce() {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  }

  // True when the styles or the code on screen are a different edition from the page.
  function mixed() {
    var css = getComputedStyle(document.documentElement)
      .getPropertyValue("--ledger-build").replace(/["'\s]/g, "");
    return css !== BUILD || (window.LEDGER_BUILD || "") !== BUILD;
  }

  // When a new offline copy takes over a page that is showing mixed editions,
  // reload at once. (A page that already matches is left alone, so nothing he is
  // typing is lost.)
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (hadController && mixed()) reloadOnce();
  });

  function clearAndReload() {
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (k) { return k.indexOf("ledger-fonts") !== 0 && k !== BUILD; })
          .map(function (k) { return caches.delete(k); }));
      })
      .catch(function () { return null; })
      .then(reloadOnce);
  }

  window.addEventListener("load", function () {
    var key = "ledger-repair";
    if (!mixed()) {
      try { sessionStorage.removeItem(key); } catch (e) { /* storage blocked */ }
      if (window.name.indexOf(key) === 0) window.name = "";
      return;
    }
    // Mixed editions. Repair once per visit, and only with a signal. The attempt
    // is remembered in two places (window.name survives a reload even when the
    // phone blocks storage), so a repair can never turn into a reload loop.
    var tried = null;
    try { tried = sessionStorage.getItem(key); } catch (e) { /* storage blocked */ }
    var mark = key + ":" + BUILD;
    if (tried === BUILD || window.name === mark || !navigator.onLine) return;
    try { sessionStorage.setItem(key, BUILD); } catch (e) { /* storage blocked */ }
    window.name = mark;

    navigator.serviceWorker.getRegistration()
      .then(function (reg) { return reg ? reg.update().then(function () { return reg; }) : null; })
      .catch(function () { return null; })
      .then(function (reg) {
        setTimeout(function () {
          var w = reg && (reg.installing || reg.waiting);
          if (w) {
            // A new offline copy is still arriving; its controllerchange reloads the page.
            w.addEventListener("statechange", function () { if (w.state === "redundant") clearAndReload(); });
            return;
          }
          clearAndReload();
        }, 4000);
      });
  });
})();
