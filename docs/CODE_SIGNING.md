# Getting DeskWell signed for free

Unsigned Windows apps are blocked outright on PCs with **Smart App Control** on ("An Application Control policy has blocked this file"). Two free routes fix this.

## 1. Microsoft Store (fastest)

The Store signs MSIX packages for free after certification, and Store apps install with Smart App Control on. Store apps can also be installed from a terminal with `winget install --id <StoreID> --source msstore`.

1. Register as an individual developer at https://storedeveloper.microsoft.com (free; needs a personal Microsoft account, a government ID photo and a selfie).
2. In Partner Center, create the app and reserve the name **DeskWell**.
3. Open *Product management > Product identity*. Copy **Package/Identity/Name**, **Package/Identity/Publisher** and **Package/Properties/PublisherDisplayName** into the repository variables `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_NAME`.
4. Run the **Microsoft Store package** workflow (Actions tab). Download the `deskwell-msix` artifact.
5. Create a submission: upload the `.msix`, fill in pricing (Free), the store listing (description, screenshots from `docs/`), age rating and the privacy policy URL (the README's privacy section). Submit for certification.
6. When it is published, put the Store ID (like `9NXXXXXXXXXX`) into `$storeId` in `scripts/install.ps1`. The one-line installer then installs the signed Store build.

Known limitation in the Store build: the "start with Windows" toggle may not work yet inside the MSIX package.

## 2. SignPath Foundation (signed GitHub installers)

SignPath Foundation signs open-source projects for free. Requirements (from signpath.org/terms): OSI license (MIT ✓), actively maintained and already released (✓), a code signing policy on the home page (see README ✓), MFA on GitHub and SignPath for every team member, builds from source on CI with manual approval for each release. SignPath also requires "a certain verifiable reputation", so a brand-new project can be turned down or asked to wait; acceptance is at their discretion.

Apply at https://signpath.org/apply. After approval, SignPath gives an organization ID, a project slug and a signing policy; then the release workflow is extended to send the Windows build to SignPath for signing before it is attached to the release.
