# Release checklist

## Metadata and supported APIs

- Confirm package `homebridge-zont-thermostat`, alias `ZontPlatform`, repository/issues/homepage and license.
- Keep `package.json` and root lock metadata at the same version; commit `package-lock.json`.
- Keep `homebridge-plugin` and `supports-hap` keywords. Do not claim Matter support.
- Check Homebridge `^2.0.0`, Node `^22.12.0 || ^24.0.0 || ^26.0.0` and current LTS security patches.
- Recheck [ZONT's current schema](https://my.zont.online/api/widget/v3/docs); the documented baseline is **26.11.2**.
- Review API/dependency release notes, including authentication changes, before refreshing the lock.
- The jsdom major is intentionally constrained by minimum Node compatibility. HAP is a dev dependency and must come from Homebridge at runtime.

## Automated gate

```bash
npm ci
npm run check
npm run test:coverage
npm audit
npm pack --dry-run --ignore-scripts
git diff --check
```

- Require CI green on minimum Node 22.12.0 and current Node 22/24/26.
- Keep real-HAP tests; fake characteristics must not invent APIs.
- Keep DOM tests for config preservation, Save gating, partial discovery and ephemeral 2FA.
- Confirm coverage thresholds (95% lines / 90% branches / 95% functions) apply to the documented scope, not a misleading whole-project claim.
- Check package contents include `index.js`, `lib`, schema, custom UI, README, license/security/changelog and docs.
- Exclude credentials, backups, logs, local `node_modules`, tests/dev dependencies and duplicate assets. Production install must only require UI-utils.

## Manual gate

Complete the real-device checklist in [Testing](testing.md). In particular:

- test pairing, Siri and automation behavior on updated Apple Home/iOS 27;
- confirm dependent read-only targets and cooling UI on available hardware;
- verify 2FA/token notification behavior without accidentally issuing duplicate tokens;
- verify preserved Child Bridge settings;
- simulate cloud/device/sensor failure and recovery, including unavailable startup;
- ensure transient missing entities do not erase Home rooms/automations;
- understand that target writes switch ZONT to manual target mode, and timeouts may mean delivery is uncertain.

Record checks not performed. Do not replace hardware validation with a claim of certification.

## Review and publishing

1. Review the entire tree and diff, including pre-existing local changes intended for this release. Scan for secrets.
2. Obtain an independent full code review; fix findings and rerun review/checks until there are no outstanding blocking findings.
3. Update changelog and documentation, commit and push without rewriting unrelated history. Verify GitHub Actions for the pushed commit.
4. Publish to npm/create release tags **only when explicitly authorized**. A GitHub push is not npm publication.

```bash
npm publish --dry-run
# Only after explicit publication approval:
npm publish
```

## Homebridge Verified readiness

Check the current official Verified program rather than relying on a frozen list. The plugin should be a dynamic platform with settings UI, current supported LTS versions, safe error handling, public source/issues and matching published release metadata. It must not include analytics or post-install system modifications. Stating readiness is not a claim that verification has been granted.
