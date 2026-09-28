# Vercel preview deployment

Deploy the staging branch as Preview. Do not promote it or attach the production custom domain. Builds work without commerce credentials; operations fail closed until configured.

1. Authenticate with `vercel login`, then select the approved account/project with `vercel link`.
2. Set `config/environment.example` variables in the project's **Preview** environment. Never use `NEXT_PUBLIC_` prefixes or embed values in vercel.json. Mark database, encryption, limiter and Auth administration credentials sensitive. Never configure the provisioning or payment-verifier database credential in the web runtime.
3. Use an approved staging store and data. The current hosted project has schema only. Configure a TLS checkout connection inheriting only trait_checkout, a stable envelope key, approved tracking lifetime and distributed limiter. Leave TRAIT_TRUSTED_IP_HEADER unset until ingress overwrite guarantees are verified; the conservative shared limit remains active.
4. Configure a stable HTTPS Preview URL, exact /admin/recovery redirect and Supabase Auth allowlist/email delivery. Keep public signup disabled. Provision approved identities and memberships, then enable staff login.
5. Run `vercel deploy --target preview` without --prod. Enable deployment protection. Redeploy after environment changes.
6. Run `npm run check:environment` with securely supplied settings. It checks configuration shape, not external-service readiness.

.vercelignore excludes local environment files, imported archives and generated output from CLI uploads. Git ignores these separately.

## Acceptance

- Follow the public Admin / Staff Login link to /admin. Exercise real ADMIN, OWNER and EMPLOYEE sessions, direct-action denial, assignment revocation, invitations and recovery.
- Complete delivery and pickup cash orders, quote changes, retries, cross-device tracking, fulfillment and cash/refund reporting. Cash requires no gateway; online preference/reference does not settle payment.
- Run independent-connection hosted race/load tests. Local in-memory tests do not establish these guarantees.
- Verify HTTPS headers, log redaction, backup/restore, monitoring, approved content and mobile accessibility.
- Image references support the configured product-images bucket. Storage provisioning and decoded-image upload/lifecycle validation remain pending; no upload endpoint is exposed.

## References

- [CLI deployment](https://vercel.com/docs/projects/deploy-from-cli)
- [Preview variables](https://vercel.com/docs/environment-variables)
- [Sensitive variables](https://vercel.com/docs/cli/env)
