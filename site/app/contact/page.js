import PolicyPageView, { policyMetadata } from "../_policy/PolicyPage";

// M5.7, D66: a permanent path. The words are in `@lailark/shared`'s
// `policies.ts`, which is also what an order's `policyVersion` is derived
// from, so this file holds no copy of its own.

export const metadata = policyMetadata("contact");

export default function Page() {
  return <PolicyPageView kind="contact" />;
}
