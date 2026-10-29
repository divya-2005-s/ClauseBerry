import { expect, test, type Page } from "@playwright/test"

/**
 * End-to-end user journeys against a running frontend + API (real database, no mocks).
 * Set SCREENSHOTS=1 to save full-page screenshots to ../docs/screenshots.
 */
const shots = !!process.env.SCREENSHOTS
const email = `e2e-${Date.now()}@example.com`
const password = "Violet-Harbor-58"

async function snap(page: Page, name: string) {
  if (!shots) return
  await page.waitForTimeout(600)
  await page.screenshot({ path: `../docs/screenshots/${name}.png`, fullPage: false })
}

async function signIn(page: Page, accountEmail = email) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(accountEmail)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test.describe.serial("ClauseBerry journeys", () => {
  test("landing page shows live dataset statistics", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: /Know what you agreed to/ })).toBeVisible()
    await expect(page.getByText("apps tracked")).toBeVisible()
    await expect(page.getByText(/Real change from the archive/)).toBeVisible()
    await snap(page, "landing")
    await page.emulateMedia({ colorScheme: "dark" })
    await snap(page, "landing-dark")
  })

  test("protected pages redirect to sign-in", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/)
    await snap(page, "sign-in")
  })

  test("sign-up validates input and creates an account", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByText("Tell us what to call you")).toBeVisible()
    await expect(page.getByText("Please accept to continue")).toBeVisible()
    await snap(page, "sign-up-errors")
    await page.getByLabel("Name").fill("E2E Reviewer")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("checkbox").check()
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
    await expect(page.getByText(/Email delivery isn.t configured/)).toBeVisible()
    await page.getByRole("button", { name: "Continue to dashboard" }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test("wrong password shows an error", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill("not-the-password-1")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("That email and password combination didn't work.")).toBeVisible()
  })

  test("dashboard renders KPIs and charts from the API", async ({ page }) => {
    await signIn(page)
    await expect(page.getByText("Meaningful changes").first()).toBeVisible()
    await expect(page.getByRole("region", { name: "Meaningful policy changes over time" })).toBeVisible()
    await expect(page.locator(".recharts-surface").first()).toBeVisible()
    await snap(page, "dashboard")
    await page.getByRole("button", { name: "Show table" }).first().click()
    await expect(page.getByRole("columnheader", { name: "Quarter" }).first()).toBeVisible()
  })

  test("directory search, follow and app detail", async ({ page }) => {
    await signIn(page)
    await page.goto("/apps")
    await page.getByLabel("Search applications").fill("linked")
    await expect(page.getByText("1 app match your filters")).toBeVisible()
    await page.getByRole("button", { name: "Follow" }).first().click()
    await expect(page.getByText(/Following LinkedIn/)).toBeVisible()
    await page.getByLabel("Search applications").fill("")
    await snap(page, "apps")
    await page.goto("/apps/linkedin")
    await expect(page.getByRole("heading", { name: "LinkedIn" })).toBeVisible()
    await expect(page.getByText("Latest meaningful change")).toBeVisible()
    await snap(page, "app-detail")
    await page.getByRole("link", { name: /See the full comparison/ }).click()
    await expect(page.getByText("Provenance")).toBeVisible()
    await expect(page.getByText(/added/).first()).toBeVisible()
    await snap(page, "change-detail")
  })

  test("AI-training tracker lists evidence", async ({ page }) => {
    await signIn(page)
    await page.goto("/ai-training")
    await expect(page.getByText("Explicit training language").first()).toBeVisible()
    await page.getByRole("button", { name: /LinkedIn/ }).click()
    await expect(page.getByText(/train/i).first()).toBeVisible()
    await snap(page, "ai-training")
  })

  test("Ask ClauseBerry answers with citations", async ({ page }) => {
    await signIn(page)
    await page.goto("/ask")
    await page.getByLabel("Your question").fill("How long does Spotify keep my data?")
    await page.getByRole("button", { name: "Send question" }).click()
    await expect(page.getByText(/Sources \(\d+\)/)).toBeVisible({ timeout: 45_000 })
    await expect(page.locator("#cite-1")).toBeVisible()
    await snap(page, "ask")
  })

  test("alerts show backfilled changes and can be marked read", async ({ page }) => {
    await signIn(page)
    await page.goto("/alerts")
    await expect(page.getByText(/LinkedIn updated its/).first()).toBeVisible()
    await snap(page, "alerts")
    await page.getByRole("button", { name: "Mark all read" }).click()
    await expect(page.getByText(/Marked \d+ alerts as read|already read/)).toBeVisible()
  })

  test("settings persist notification preferences", async ({ page }) => {
    await signIn(page)
    await page.goto("/settings")
    await page.getByLabel("Only AI-training changes").click()
    await page.getByRole("button", { name: "Save preferences" }).click()
    await expect(page.getByText("Notification preferences saved")).toBeVisible()
    await page.reload()
    await expect(page.getByLabel("Only AI-training changes")).toBeChecked()
    await snap(page, "settings")
  })

  test("pricing upgrade is honest about billing", async ({ page }) => {
    await signIn(page)
    await page.goto("/pricing")
    await page.getByRole("button", { name: "Join the Pro waitlist" }).click()
    await expect(page.getByText(/nothing will be charged/)).toBeVisible()
    await snap(page, "pricing")
  })

  test("monitoring health and per-app check controls load", async ({ page, request }) => {
    const accountEmail = `e2e-monitor-${Date.now()}@example.com`
    const signup = await request.post("/api/auth/signup", {
      data: { name: "E2E Monitoring", email: accountEmail, password, accept_terms: true },
    })
    expect(signup.status()).toBe(201)
    await signIn(page, accountEmail)

    await page.goto("/monitoring")
    await expect(page.getByRole("heading", { name: "Monitoring health" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible()
    await expect(page.getByText("LinkedIn", { exact: true })).toBeVisible()

    await page.goto("/apps/linkedin")
    await expect(page.getByRole("button", { name: "Check now" })).toBeVisible()
  })

  test("ClauseBerry logo navigates home from shared navigation @mobile", async ({ page, request }) => {
    async function clickBrand() {
      const brand = page.getByRole("link", { name: "ClauseBerry home" }).filter({ visible: true }).first()
      await expect(brand).toBeVisible()
      await expect(brand).toHaveAttribute("href", "/")
      await brand.click()
      await expect(page).toHaveURL("/")
    }

    for (const path of ["/pricing", "/sign-in"]) {
      await page.goto(path)
      await clickBrand()
    }

    const accountEmail = `e2e-logo-${Date.now()}@example.com`
    const signup = await request.post("/api/auth/signup", {
      data: { name: "E2E Brand", email: accountEmail, password, accept_terms: true },
    })
    expect(signup.status()).toBe(201)

    await signIn(page, accountEmail)
    await page.goto("/apps")
    await clickBrand()
  })

  test("any two policy versions can be compared from the UI", async ({ page }) => {
    await signIn(page)
    await page.goto("/apps/reddit")
    await page.getByRole("tab", { name: "Versions" }).click()
    const pickers = page.getByRole("combobox").filter({ hasText: "Choose a version" })
    await pickers.first().click()
    await page.getByRole("option").nth(3).click() // older
    await pickers.first().click()
    await page.getByRole("option").first().click() // newest
    await page.getByRole("button", { name: "Compare versions" }).click()
    await expect(page).toHaveURL(/\/apps\/reddit\/compare\?from=\d+&to=\d+/)
    await expect(page.getByText(/^\s*\d+ added\s*$/)).toBeVisible()
    await expect(page.getByText(/^\s*\d+ removed\s*$/)).toBeVisible()
  })

  test("theme switches between light and dark", async ({ page }) => {
    await page.goto("/")
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.getByRole("button", { name: "Change theme" }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    const dark = await bg()
    await page.getByRole("button", { name: "Change theme" }).click()
    await page.getByRole("menuitemradio", { name: "Light" }).click()
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    expect(await bg()).not.toBe(dark)
  })

  test("sign-out ends the session", async ({ page }) => {
    await signIn(page)
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    expect((await page.request.get("/api/auth/me")).status()).toBe(401)
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/)
  })

  test("key pages render without browser console errors", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text().slice(0, 200)}`))
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message.slice(0, 200)}`))
    await signIn(page)
    for (const path of ["/dashboard", "/apps", "/apps/linkedin", "/ai-training", "/ask", "/alerts", "/settings", "/pricing", "/"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
    }
    expect(errors).toEqual([])
  })

  test("mobile layout has no horizontal overflow @mobile", async ({ page }) => {
    for (const path of ["/", "/sign-in", "/pricing"]) {
      await page.goto(path)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, path).toBeLessThanOrEqual(1)
    }
    const r = await page.request.post("/api/auth/signup", {
      data: { name: "Mobile", email: `m-${Date.now()}@example.com`, password, accept_terms: true },
    })
    expect(r.status()).toBe(201)
    for (const path of ["/dashboard", "/apps", "/apps/reddit", "/alerts", "/ask"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, path).toBeLessThanOrEqual(1)
    }
    await snap(page, "mobile-ask")
  })
})
