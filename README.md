# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/login?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/login` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/login`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## 회원 요금제
- Free: 피드 3개(공용 목록에 없는 커스텀 URL 최대 1개), 3시간 갱신, 화이트/블랙 키워드 각각 5개.
- Basic: 월 5,900원, 피드 10개, 30분 갱신, 번역, 월 AI 크레딧 100개, 키워드 각각 20개.
- Pro: 월 11,000원, 피드 30개, 10분 갱신, 번역, 월 AI 크레딧 300개, 키워드 각각 50개.
- 기존 및 신규 회원은 기본 Free. 관리자 회원 수정에서 유료 요금제와 종료일을 지정합니다. 결제·자동 청구 연동은 미구현입니다.
- 요금제 정보는 개인 계정 state의 서버 전용 `_membership`에 저장합니다. 일반 계정 수정 API는 이 필드를 받지 않습니다. 만료 시 Free 전환, 월 크레딧 갱신은 최초 요청에서 조건부 DB 업데이트로 처리합니다. 별도 DB 마이그레이션은 필요 없습니다.
- 크레딧은 한국시간 달력 월 기준, 미사용분 이월 없음. AI 분석 및 요약 새 생성은 1개 차감, 기존 결과 재조회는 추가 차감 없음. 실패 반환은 현재 월 할당량 내에서 1회만 처리합니다.
- 개인 RSS 응답 스냅샷에 요금제별 TTL을 적용하며 외부 RSS 수집은 기존 공유 캐시로 병합합니다. 브라우저 자동 갱신은 페이지가 열린 동안 실행됩니다.
- 다운그레이드 시 기존 소스/키워드는 삭제하지 않습니다. 피드는 앞쪽 한도만 갱신하고 키워드는 앞쪽 한도만 적용합니다. 초과분 삭제는 허용하고 한도 초과 추가는 서버에서 차단합니다.
- 번역은 브라우저 기능이며 유료 권한에 따라 앱에서 실행을 제한합니다. 사용자가 직접 사용하는 외부 브라우저 번역 기능까지 통제하지 않습니다.
- 검증: `node scripts/verify-plans.mjs` (격리 SQLite, 외부 API 호출 없음).

## 토스페이먼츠 결제·정기 청구
- `/billing`: 요금제 선택, 자동 청구 동의, 토스 카드 등록, 최초 결제, 구독 해지 및 본인 결제 내역.
- `/admin/billing`: 빌링 계약 상점의 API 개별 연동 키를 암호화 저장. 테스트 결제는 실제 회원 등급에 영향을 주지 않습니다. 운영 결제는 스케줄러의 최근 실행 확인이 필요합니다.
- 카드 원문은 토스 결제창에서만 입력하며 시크릿 키와 빌링키는 기존 서버 AES-GCM 암호화 키로 암호화합니다. 인증 콜백은 로그인 계정·서버 발급 nonce·무작위 customerKey·유효기간을 검증합니다.
- 결제 금액은 서버 요금제에서 결정합니다. 승인 주문번호·금액·통화·상태를 검증한 뒤 live 모드에만 등급을 부여합니다. 주문별 멱등키·DB 잠금으로 중복 결제를 방지하며, 통신 결과 불명은 재청구하지 않고 조회로 확인합니다. 실패 결제는 자동 재시도하지 않습니다.
- 매월 결제일은 최초 결제 날짜 기준 (KST), 없는 날짜는 말일입니다. 해지하면 다음 청구가 중단되고 유료 이용 종료일은 유지됩니다.
- 정기 청구: Site MCP `run_subscription_billing` (관리자 인증 필수)을 연결한 Sites 자동화로 매시간 실행합니다. 1회 최대 10개 청구/10개 결과 확인이므로 서비스 규모 증가 시 전용 결제 워커로 전환해야 합니다. 스케줄 연결·실행이 확인되기 전 운영 결제는 활성화하지 않습니다. 브라우저 조회로 자동 결제를 소비하지 않습니다.
- 토스 개발자센터의 `PAYMENT_STATUS_CHANGED` 웹훅 URL: `https://hanstaget.com/api/billing/webhook`. 웹훅 본문 자체를 승인 근거로 신뢰하지 않고 토스 API로 재조회합니다. 전액 취소가 확인되면 해당 최신 결제의 권한과 재청구를 중단합니다. 부분 환불·분쟁은 관리자 수동 처리입니다.
- 운영 시작 전: 토스 빌링 계약 승인, 테스트 키로 실제 연동 검증, 상점 사업자/환불/약관 안내, 웹훅 등록, 스케줄 연결, 운영 키 입력이 필요합니다. 라이브 키를 채팅에 붙여 넣지 말고 관리자 설정에 입력합니다.
- 격리 검증: `node scripts/verify-billing.mjs`. 테스트는 모의 PG 응답으로만 실행하며 실제 카드 결제를 발생시키지 않습니다.
