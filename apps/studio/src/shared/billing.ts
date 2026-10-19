/**
 * Subscription states in which the last payment failed and is still owed,
 * the ones the API refuses with `payment-failed`. A Stripe trial that ended
 * without a card pauses, and a card is what resumes it.
 */
export const PAYMENT_FAILED_STATUSES = new Set([
  "incomplete",
  "past_due",
  "paused",
  "unpaid",
]);
