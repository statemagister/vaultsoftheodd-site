/* Lightweight client-side search over /index.json. No dependencies. */
(function () {
  var input = document.getElementById('site-search');
  if (!input) return;
  var results = document.getElementById('search-results');
  var index = null, loading = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(q) {
    if (!results) return;
    q = (q || '').trim().toLowerCase();
    if (!q || !index) { results.innerHTML = ''; results.hidden = true; return; }
    var terms = q.split(/\s+/);
    var matches = index.filter(function (it) {
      var hay = (it.title + ' ' + (it.tags || []).join(' ') + ' ' +
                 (it.settings || []).join(' ') + ' ' + (it.summary || '')).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    }).slice(0, 8);
    if (!matches.length) {
      results.innerHTML = '<li class="search-empty">No matches</li>';
      results.hidden = false;
      return;
    }
    results.innerHTML = matches.map(function (m) {
      var meta = (m.settings && m.settings.length) ? m.settings[0] : (m.section || '');
      return '<li><a href="' + m.url + '">' + escapeHtml(m.title) +
             (meta ? '<span class="search-meta">' + escapeHtml(meta) + '</span>' : '') +
             '</a></li>';
    }).join('');
    results.hidden = false;
  }

  function load() {
    if (index || loading) return;
    loading = true;
    fetch('/index.json').then(function (r) { return r.json(); })
      .then(function (d) { index = d; render(input.value); })
      .catch(function () { loading = false; });
  }

  input.addEventListener('focus', load);
  input.addEventListener('input', function () { index ? render(input.value) : load(); });
  // Hide results when clicking away
  document.addEventListener('click', function (e) {
    if (results && !results.contains(e.target) && e.target !== input) results.hidden = true;
  });
})();
