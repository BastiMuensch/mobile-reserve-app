/** Server revocation and local unsubscribe must both be attempted, independently.
 * A network failure must never skip local revocation on a shared device. */
export async function revokePushSubscription(
  subscription: { endpoint: string; unsubscribe: () => Promise<boolean> },
  revokeOnServer: (endpoint: string) => Promise<boolean>,
): Promise<boolean> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => revokeOnServer(subscription.endpoint)),
    Promise.resolve().then(() => subscription.unsubscribe()),
  ]);
  return results.every(result => result.status === 'fulfilled' && result.value);
}

export function privatePushPayload() {
  return { title: 'MobileReserve.digital', body: 'Es gibt eine neue Information zu Ihrem Einsatzplan. Bitte öffnen Sie die App.' };
}
