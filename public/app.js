/* দরদেখা — progressive enhancement for the live lookup.
   The page is fully server-rendered; this only makes the search feel
   immediate. Without JavaScript the form still works — it falls back to
   the /verify page. */

(function () {
  var form = document.getElementById("lookup");
  var input = document.getElementById("q");
  var out = document.getElementById("answer");
  if (!form || !input || !out) return;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function say(html) {
    out.innerHTML = html;
    out.classList.add("on");
  }

  function render(data) {
    if (!data || data.error) {
      say('<p class="err">' + esc((data && data.error) || "খুঁজে পাওয়া যায়নি") + "</p>");
      return;
    }
    var retail = data.prices && data.prices.retail;
    var wholesale = data.prices && data.prices.wholesale;
    var r = data.retail || retail;

    if (data.scope === "national") {
      say(
        '<div class="ans">' +
          '<span class="big">' + esc(r.min) + "–" + esc(r.max) + " টাকা/" + esc(r.unit_bn || "কেজি") + "</span>" +
          '<span class="meta">জেলা-গড় ' + esc(r.avg) + " টাকা · " + esc(data.districts_reporting) + "টি জেলা থেকে তথ্য · " + esc(data.price_date) +
          ' · <a href="' + esc(data.canonical_url) + '">সব জেলার দর</a>' +
          "</span></div>",
      );
      return;
    }

    var unit = (r && r.unit_bn) || "কেজি";
    var range =
      r && r.min !== null && r.max !== null && r.max !== r.min ? r.min + "–" + r.max : r && r.avg;
    var wh = wholesale && wholesale.avg !== null ? " · পাইকারি " + wholesale.avg : "";
    var alt = data.alternatives && data.alternatives.commodities && data.alternatives.commodities.length
      ? ' · অন্যান্য: ' + esc(data.alternatives.commodities.slice(0, 2).join(", "))
      : "";
    say(
      '<div class="ans">' +
        '<span class="big">' + esc(range) + " টাকা/" + esc(unit) + esc(wh) + "</span>" +
        '<span class="meta">' + esc(data.commodity.name_bn) + " — " + esc(data.district.name_bn) +
        " · " + esc(data.price_date) +
        (data.carried_forward ? ' · <span class="stamp carry">পূর্বের মান</span>' : "") +
        alt +
        (data.canonical_url ? ' · <a href="' + esc(data.canonical_url) + '">উৎস পাতা</a>' : "") +
        "</span></div>",
    );
  }

  function lookup(q) {
    fetch("/api/v1/search?q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        say('<p class="err">একটু পরে আবার চেষ্টা করুন।</p>');
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    lookup(q);
  });

  var chips = document.querySelectorAll(".chip[data-q]");
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener("click", function (e) {
      var q = e.currentTarget.getAttribute("data-q");
      input.value = q;
      lookup(q);
    });
  }
})();
