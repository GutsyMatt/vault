// Google sign-in for FamilyOS (same Google client as lifeos.libbyhd.org). No PHI here.
const box = document.getElementById("g");
const err = document.getElementById("err");
function showError(msg) {
	err.textContent = msg;
	err.hidden = false;
}
async function onCredential(resp) {
	try {
		const r = await fetch("/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) });
		if (r.ok) return location.reload();
		const body = await r.json().catch(() => ({}));
		showError(body.error || `Sign-in failed (${r.status})`);
	} catch {
		showError("Could not reach the server. Check your connection and try again.");
	}
}
function start() {
	if (!window.google?.accounts?.id) return setTimeout(start, 100);
	google.accounts.id.initialize({ client_id: box.dataset.clientId, callback: onCredential, auto_select: true, ux_mode: "popup", itp_support: true });
	google.accounts.id.renderButton(box, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with" });
	google.accounts.id.prompt();
}
start();
