import { execSync } from "node:child_process";
import fs from "node:fs";
import { debugLog } from "./utils.js";

/**
 * Checks if a URL redirects to a password protection page
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>} - True if the URL redirects to /password
 */
const isPasswordProtected = async (url) => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    const finalUrl = response.url;
    const urlObj = new URL(finalUrl);
    return (
      urlObj.pathname === "/password" || urlObj.pathname.endsWith("/password")
    );
  } catch (err) {
    debugLog("Error checking password protection", {
      error: err.message,
      url,
    });
    return false;
  }
};

const PR_BODY = process.env.PR_BODY || "";
const PATH_REGEX = /https:\/\/[^\s\)\]\}]+/g;

debugLog("Environment variables", {
  PR_BODY: PR_BODY.substring(0, 200) + (PR_BODY.length > 200 ? "..." : ""),
  GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
});

const allUrls = PR_BODY.match(PATH_REGEX) || [];
debugLog("All URLs found in PR body", allUrls);

const rawPreviewUrl =
  allUrls.find((url) => url.includes("preview_theme_id=")) || "";

debugLog("Raw preview URL found", rawPreviewUrl);

let previewPathname = "";
let previewUrl = "";

if (rawPreviewUrl) {
  try {
    const parsed = new URL(rawPreviewUrl);
    previewPathname = parsed.pathname;
    const previewThemeId = parsed.searchParams.get("preview_theme_id");

    if (previewThemeId) {
      // Preserve all query parameters from the original URL
      previewUrl = `${
        parsed.origin
      }${previewPathname}?${parsed.searchParams.toString()}`;
    }
  } catch (err) {
    console.warn("Invalid preview URL:", rawPreviewUrl);
    debugLog("Error parsing preview URL", {
      error: err.message,
      url: rawPreviewUrl,
    });
  }
}

debugLog("Final preview URL", previewUrl);
debugLog("Preview pathname", previewPathname);

let liveUrl = "";
if (previewUrl) {
  try {
    const parsed = new URL(previewUrl);
    parsed.searchParams.delete("preview_theme_id");
    liveUrl = parsed.toString();
    debugLog("Derived live URL from preview URL", liveUrl);
  } catch (err) {
    debugLog("Error deriving live URL", { error: err.message });
  }
}

console.log("Preview URL:", previewUrl);
console.log("Live URL:", liveUrl);

const urlsToTest = {};

debugLog("URL processing results", {
  previewUrl,
  liveUrl,
  previewPathname,
  urlsToTest: Object.keys(urlsToTest),
});

const isValidUrl = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
};

const addUrlToTest = (url, key) => {
  if (url?.trim() && !urlsToTest[key]) {
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/[),\.]+$/, "");

    if (!isValidUrl(cleanUrl)) {
      console.warn(`Invalid URL for ${key}: ${cleanUrl}`);
      debugLog(`Skipping invalid URL for ${key}`, { url: cleanUrl });
      return;
    }

    const separator = cleanUrl.includes("?") ? "&" : "?";
    const urlWithPb = `${cleanUrl}${separator}pb=0`;
    urlsToTest[key] = urlWithPb;
    debugLog(`Added URL to test - ${key}`, {
      originalUrl: url,
      cleanUrl,
      finalUrl: urlWithPb,
    });
  } else {
    const reason = !url || !url.trim() ? "empty" : "already exists";
    debugLog(`Skipping URL for ${key}`, { url, reason });
  }
};

if (previewUrl) {
  addUrlToTest(previewUrl, "preview");
}

if (liveUrl) {
  addUrlToTest(liveUrl, "default");
}

if (Object.keys(urlsToTest).length === 0) {
  console.log("No valid URLs found for accessibility testing.");
  process.exit(0);
}

const urlEntries = Object.entries(urlsToTest).map(([key, url]) => ({
  key,
  url,
}));

// Store attempted URLs for error reporting
fs.writeFileSync("attempted-urls.json", JSON.stringify(urlsToTest, null, 2));

// Check if live URL is password protected before running any tests
(async () => {
  const liveUrlEntry = urlEntries.find((entry) => entry.key === "default");

  if (liveUrlEntry) {
    console.log("Checking if live URL is password protected...");
    const isProtected = await isPasswordProtected(liveUrlEntry.url);

    if (isProtected) {
      console.warn(
        "⚠️  Live URL is password protected, skipping all accessibility tests"
      );
      debugLog("Live URL is password protected", { url: liveUrlEntry.url });

      // Create a report indicating password protection for live URL
      fs.writeFileSync(
        "axe-report-default.json",
        JSON.stringify(
          {
            url: liveUrlEntry.url,
            passwordProtected: true,
            error: "URL redirects to password protection page",
          },
          null,
          2
        )
      );

      // Create empty preview report so comment generation knows preview wasn't tested
      if (urlsToTest.preview) {
        fs.writeFileSync(
          "axe-report-preview.json",
          JSON.stringify(
            {
              url: urlsToTest.preview,
              passwordProtected: false,
              skipped: true,
              error: "Tests skipped because live URL is password protected",
            },
            null,
            2
          )
        );
      }

      console.error("❌ Live URL is password protected. Exiting early.");
      process.exit(0);
    }
  }

  // Get ChromeDriver path from browser-driver-manager
  let chromedriverPath = "";
  try {
    const browserDriverOutput = process.env.BROWSER_DRIVER_OUTPUT || "";

    if (browserDriverOutput) {
      // Parse the CHROMEDRIVER_TEST_PATH from the output
      const chromedriverMatch = browserDriverOutput.match(
        /CHROMEDRIVER_TEST_PATH="([^"]+)"/
      );
      if (chromedriverMatch) {
        chromedriverPath = chromedriverMatch[1];
        debugLog(
          "ChromeDriver path from browser-driver-manager output",
          chromedriverPath
        );
      } else {
        debugLog("CHROMEDRIVER_TEST_PATH not found in output", {
          output: browserDriverOutput.substring(0, 500),
        });
      }
    } else {
      debugLog("BROWSER_DRIVER_OUTPUT environment variable not set");
    }
  } catch (err) {
    console.warn(
      "Could not get ChromeDriver path from browser-driver-manager:",
      err.message
    );
    debugLog("ChromeDriver path error", { error: err.message });
  }

  for (const { key, url } of urlEntries) {
    const reportPath = `axe-report-${key}.json`;

    console.log(`Running axe on ${key}: ${url}`);
    debugLog(`Starting axe test for ${key}`, {
      url,
      reportPath,
    });

    try {
      const axeCommand = chromedriverPath
        ? `axe "${url}" --save ${reportPath} --chromedriver-path ${chromedriverPath}`
        : `axe "${url}" --save ${reportPath}`;

      debugLog(`Executing axe command for ${key}`, { command: axeCommand });

      // Check if report file exists before running axe
      const reportExistsBefore = fs.existsSync(reportPath);
      debugLog("Report file exists before axe execution", {
        reportPath,
        exists: reportExistsBefore,
      });

      execSync(axeCommand, { stdio: "inherit" });

      // Check if report file exists after running axe
      const reportExistsAfter = fs.existsSync(reportPath);
      debugLog("Report file exists after axe execution", {
        reportPath,
        exists: reportExistsAfter,
      });

      if (reportExistsAfter) {
        const reportContent = fs.readFileSync(reportPath, "utf8");
        debugLog("Report file content length", {
          reportPath,
          contentLength: reportContent.length,
        });
        console.log(`Saved: ${reportPath}`);
        debugLog(`Successfully completed axe test for ${key}`, { reportPath });
      } else {
        console.error(`❌ Report file not created: ${reportPath}`);
        debugLog("Report file not found after axe execution", { reportPath });
      }
    } catch (err) {
      console.error(`❌ Error running axe on ${key}:`, err.message);
      debugLog(`Error running axe test for ${key}`, {
        error: err.message,
        url,
      });

      // Check if report file was created despite the error
      const reportExistsAfterError = fs.existsSync(reportPath);
      debugLog("Report file exists after error", {
        reportPath,
        exists: reportExistsAfterError,
      });

      fs.writeFileSync(
        reportPath,
        JSON.stringify({ error: err.message, url }, null, 2)
      );
    }
  }
})();
