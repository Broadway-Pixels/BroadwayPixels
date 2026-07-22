const supportForm = document.querySelector("#support-form");
const supportStatus = document.querySelector("#support-status");
const projectSelect = document.querySelector("#support-project");
const requestIdInput = document.querySelector("#support-request-id");

const projectFromUrl = new URLSearchParams(window.location.search).get("project");
if (projectFromUrl && projectSelect) {
  const matchingOption = Array.from(projectSelect.options).find((option) => option.value.toLowerCase() === projectFromUrl.toLowerCase());
  if (matchingOption) projectSelect.value = matchingOption.value;
}

const newRequestId = () => {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

if (requestIdInput) requestIdInput.value = newRequestId();

supportForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supportForm.reportValidity()) return;

  const submitButton = supportForm.querySelector('button[type="submit"]');
  const formData = new FormData(supportForm);
  const payload = Object.fromEntries(formData.entries());

  submitButton.disabled = true;
  submitButton.textContent = "Sending...";
  supportStatus.className = "form-status form-status-pending";
  supportStatus.textContent = "Sending your message securely.";

  try {
    const response = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(result.message || "Your message could not be sent.");

    supportStatus.className = "form-status form-status-success";
    supportStatus.textContent = result.confirmationSent
      ? `Your message was sent. Ticket ${result.ticketId}. A confirmation was emailed to ${payload.email}.`
      : `Your message was sent as ticket ${result.ticketId}. Broadway Pixels will reply by email.`;
    supportForm.reset();
    if (requestIdInput) requestIdInput.value = newRequestId();
  } catch (error) {
    supportStatus.className = "form-status form-status-error";
    const emailLink = document.createElement("a");
    emailLink.href = "mailto:Media@BroadwayPixels.com";
    emailLink.textContent = "Media@BroadwayPixels.com";
    supportStatus.replaceChildren("The web form is unavailable right now. Please email ", emailLink, ".");
    console.error(error);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send message";
  }
});
