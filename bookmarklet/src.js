(function () {
  var TOKEN = '__PASSENGER_TOKEN__';
  var API = '__PASSENGER_API__';

  function showToast(msg, ok) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;top:16px;right:16px;padding:12px 16px;' +
      'background:' + (ok ? '#0a7d2c' : '#a02020') + ';color:#fff;' +
      'border-radius:6px;z-index:2147483647;font:14px/1.3 system-ui,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  var v = document.querySelector('video');
  if (!v || !v.currentSrc) {
    showToast('Passenger: no <video> with a src found. Press play first.', false);
    return;
  }

  var rawTitle = document.title || 'Untitled';
  var title = rawTitle.replace(/\s*-\s*Thecalm\.site\s*$/i, '').trim() || 'Untitled';

  fetch(API + '/api/queue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-passenger-token': TOKEN,
    },
    body: JSON.stringify({ url: v.currentSrc, title: title }),
  })
    .then(function (r) {
      if (r.ok) {
        showToast('Passenger: queued "' + title + '"', true);
      } else {
        showToast('Passenger: queue failed (' + r.status + ')', false);
      }
    })
    .catch(function (e) {
      showToast('Passenger: network error: ' + (e && e.message), false);
    });
})();
