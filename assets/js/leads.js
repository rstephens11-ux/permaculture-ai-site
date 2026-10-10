// assets/js/leads.js — every waitlist form on the site. One handler, tagged by source, so we always
// know which page earned the address.

document.querySelectorAll("form[data-lead-form]").forEach((form) => {
  const status = form.querySelector("[data-lead-status]");
  const button = form.querySelector("button");
  const input = form.querySelector("input[type=email]");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) {
      if (status) status.textContent = "An email address, please.";
      return;
    }
    button.disabled = true;
    button.textContent = "Adding…";
    try {
      const r = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          source: form.dataset.leadForm || "unknown",
          note: form.dataset.leadNote || ""
        })
      });
      const j = await r.json();
      if (!r.ok) {
        if (status) status.textContent = j.message || "That didn't take.";
        button.disabled = false;
        button.textContent = "Try again";
        return;
      }
      form.innerHTML = `<p><strong>You're on the list.</strong> Nothing else will land in your inbox
        until The Preservation Run is real — and then it's one email.</p>`;
    } catch {
      if (status) status.textContent = "Couldn't reach the server. Try again in a minute.";
      button.disabled = false;
      button.textContent = "Try again";
    }
  });
});
