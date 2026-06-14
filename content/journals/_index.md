---
title: "The Journals"
---

Journals published under the Vaults of the ODD imprint. Each one is built to be used and kept: hardback, with a date margin on every page for circle-the-date journalling, so a single journal works for any year and never goes out of date.

The first titles are in preparation. Each is offered in a choice of covers — pick the one you like, and choose a different cover next time. Buy links will go live as each journal is published. If you bought a journal that carried this website on its cover, welcome; this is the home it points to.

<div class="product-grid">

  <div class="product-card">
    <h3 class="product-name">The Perpetual Journal</h3>
    <div class="product-covers">
      <span class="book-cover" style="--c:#0b0b0d"></span>
      <span class="book-cover" style="--c:#f26b24"></span>
    </div>
    <p class="product-desc">A clean, undated hardback in a plain cover — open it on any day and carry it through any year. A slim date strip runs down the outer edge of every page: circle the month, circle the date and write the year in the box. Nothing is printed to a fixed date, so no page is wasted and the book never expires on a shelf. 256 lined, numbered pages, with a two-page index and an ownership and volume page for keeping a numbered set. Hardcover, 7 × 10 inches.</p>
    <p class="product-variants">Choose your cover and store:</p>
    <div class="buy">
      <p class="buy-row"><span class="buy-cover">Black</span><a class="button" data-store="us" href="https://www.amazon.com/dp/B0H599D1NW" rel="noopener noreferrer" target="_blank">Amazon US</a><a class="button ghost" data-store="uk" href="https://www.amazon.co.uk/dp/B0H599D1NW" rel="noopener noreferrer" target="_blank">Amazon UK</a></p>
      <p class="buy-row"><span class="buy-cover">Orange</span><a class="button" data-store="us" href="https://www.amazon.com/dp/B0H58YCR9F" rel="noopener noreferrer" target="_blank">Amazon US</a><a class="button ghost" data-store="uk" href="https://www.amazon.co.uk/dp/B0H58YCR9F" rel="noopener noreferrer" target="_blank">Amazon UK</a></p>
    </div>
    <p class="product-status available">Available now on Amazon</p>
  </div>

  <div class="product-card">
    <h3 class="product-name">The Monster Hunter's Journal</h3>
    <div class="product-covers">
      <img class="cover-img" src="/images/journals/monster-hunters-journal-midnight.png" alt="The Monster Hunter's Journal, midnight cover" loading="lazy">
      <img class="cover-img" src="/images/journals/monster-hunters-journal-gold.png" alt="The Monster Hunter's Journal, gold cover" loading="lazy">
    </div>
    <p class="product-desc">A campaign keepsake for any tabletop roleplaying game: a chronological log of every creature your party brings down, with character pages, trackers, and an atmospheric bestiary running through it. System-agnostic — bring your own monsters.</p>
    <p class="product-variants">Cover options: Midnight &middot; Gold</p>
    <p class="product-status">In preparation</p>
  </div>

</div>

## Also planned for the range

Further titles are on the way. These are in development behind the first two.

<div class="product-grid">

  <div class="product-card">
    <div class="product-cover placeholder">Cover<br>to come</div>
    <h3 class="product-name">The Gothic Creature Journal</h3>
    <p class="product-desc">A gothic-horror line for the table: period engravings and atmospheric prompts, with sections for the creatures of folklore — vampires, werewolves, liches, ghouls, witches and ghosts. Made for players of dark fantasy.</p>
    <p class="product-status">Planned</p>
  </div>

  <div class="product-card">
    <div class="product-cover placeholder">Cover<br>to come</div>
    <h3 class="product-name">The Game Master's Notebook</h3>
    <p class="product-desc">A system-agnostic campaign design notebook for running any tabletop roleplaying game. Structured space for worlds, sessions, NPCs and the long thread of a campaign.</p>
    <p class="product-status">Planned</p>
  </div>

  <div class="product-card">
    <div class="product-cover placeholder">Cover<br>to come</div>
    <h3 class="product-name">The Player's Campaign Journal</h3>
    <p class="product-desc">A journal for players to keep the record of a campaign from their own side of the table: their character, the people they meet, and the story as they lived it.</p>
    <p class="product-status">Planned</p>
  </div>

</div>

All journals are independent products under the Vaults of the ODD imprint. They are not affiliated with, or endorsed by, any game publisher.

<script>
(function () {
  var uk = false;
  try { uk = /^en-GB/i.test(navigator.language || '') || (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London'); } catch (e) {}
  if (!uk) return;
  // UK visitors: lead with the UK store instead of the US default.
  var rows = document.querySelectorAll('.buy-row');
  for (var i = 0; i < rows.length; i++) {
    var us = rows[i].querySelector('[data-store="us"]');
    var gb = rows[i].querySelector('[data-store="uk"]');
    if (us && gb) { us.classList.add('ghost'); gb.classList.remove('ghost'); rows[i].insertBefore(gb, us); }
  }
})();
</script>
