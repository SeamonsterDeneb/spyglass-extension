(function() {
  // ── View toggle ──────────────────────────────────────────
  const viewBtns   = document.querySelectorAll('.sg-view-btn');
  const cardsView  = document.getElementById('sg-cards-view');
  const tableView  = document.getElementById('sg-table-view');

  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      viewBtns.forEach(b => {
        b.classList.remove('sg-view-btn--active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('sg-view-btn--active');
      btn.setAttribute('aria-pressed', 'true');

      if (view === 'cards') {
        cardsView.style.display = 'grid';
        tableView.style.display = 'none';
      } else {
        cardsView.style.display = 'none';
        tableView.style.display = 'block';
      }
    });
  });

  // ── Sort ─────────────────────────────────────────────────
  const sortSelect = document.getElementById('sg-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const val       = sortSelect.value;
      const cards     = Array.from(document.querySelectorAll('.sg-card'));
      const rows      = Array.from(document.querySelectorAll('#sg-table-view tbody tr'));
      const cardsWrap = document.getElementById('sg-cards-view');
      const tbody     = document.querySelector('#sg-table-view tbody');

      function sortItems(items, attr, dir, isNum) {
        return items.sort((a, b) => {
          let av = a.dataset[attr] || '';
          let bv = b.dataset[attr] || '';
          if (isNum) { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
          if (dir === 'asc') return isNum ? av - bv : av.localeCompare(bv);
          return isNum ? bv - av : bv.localeCompare(av);
        });
      }

      let sortedCards, sortedRows;

      switch(val) {
        case 'oldest':
          sortedCards = sortItems(cards, 'timestamp', 'asc', false);
          sortedRows  = sortItems(rows,  'timestamp', 'asc', false);
          break;
        case 'submitter':
          sortedCards = sortItems(cards, 'submitter', 'asc', false);
          sortedRows  = sortItems(rows,  'submitter', 'asc', false);
          break;
        case 'org':
          sortedCards = sortItems(cards, 'org', 'asc', false);
          sortedRows  = sortItems(rows,  'org', 'asc', false);
          break;
        case 'lc_desc':
          sortedCards = sortItems(cards, 'lc', 'desc', true);
          sortedRows  = sortItems(rows,  'lc', 'desc', true);
          break;
        case 'lc_asc':
          sortedCards = sortItems(cards, 'lc', 'asc', true);
          sortedRows  = sortItems(rows,  'lc', 'asc', true);
          break;
        case 'wcag_fail':
          sortedCards = cards.sort((a,b) => a.dataset.wcagPass - b.dataset.wcagPass);
          sortedRows  = rows.sort((a,b)  => a.dataset.wcagPass - b.dataset.wcagPass);
          break;
        default: // newest
          sortedCards = sortItems(cards, 'timestamp', 'desc', false);
          sortedRows  = sortItems(rows,  'timestamp', 'desc', false);
      }

      sortedCards.forEach(c => cardsWrap.appendChild(c));
      sortedRows.forEach(r  => tbody.appendChild(r));
    });
  }
})();