const contactForm = document.querySelector("#contact-form");
const contactStatus = document.querySelector("#contact-status");
const contactTopic = document.querySelector("#contact-topic");
const contactRequestId = document.querySelector("#contact-request-id");

const topicFromUrl = new URLSearchParams(window.location.search).get("topic");
if (topicFromUrl && contactTopic) {
  const matchingOption = Array.from(contactTopic.options).find((option) => option.value.toLowerCase() === topicFromUrl.toLowerCase());
  if (matchingOption) contactTopic.value = matchingOption.value;
}

const newContactRequestId = () => {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

if (contactRequestId) contactRequestId.value = newContactRequestId();

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;

  const submitButton = contactForm.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(contactForm).entries());
  submitButton.disabled = true;
  submitButton.textContent = "Sending...";
  contactStatus.className = "form-status form-status-pending";
  contactStatus.textContent = "Sending your inquiry securely.";

  try {
    const response = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Your inquiry could not be sent.");

    contactStatus.className = "form-status form-status-success";
    contactStatus.textContent = "Your inquiry was sent. Broadway Pixels will follow up by email.";
    contactForm.reset();
    if (contactRequestId) contactRequestId.value = newContactRequestId();
  } catch (error) {
    contactStatus.className = "form-status form-status-error";
    const emailLink = document.createElement("a");
    emailLink.href = "mailto:Media@BroadwayPixels.com";
    emailLink.textContent = "Media@BroadwayPixels.com";
    contactStatus.replaceChildren("The web form is unavailable right now. Please email ", emailLink, ".");
    console.error(error);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send inquiry";
  }
});
