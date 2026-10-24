// Shared motion: headings rise line by line, blocks fade up as they enter the viewport.

export function splitHeadings(root = document) {
  for (const h of root.querySelectorAll('.split')) {
    const lines = h.innerHTML.split(/<br\s*\/?>/i);
    h.innerHTML = lines.map((l, i) => `<span class="ln"><span class="ch" style="transition-delay:${i * 90}ms">${l}</span></span>`).join('');
  }
}

export function reveal(root = document) {
  const els = root.querySelectorAll('.reveal, .split');
  if (!('IntersectionObserver' in window)) return els.forEach(e => e.classList.add('in'));
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
}

export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
