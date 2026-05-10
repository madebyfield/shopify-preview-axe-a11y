import fs from "node:fs";
import { sortByImpact, debugLog } from "./utils.js";

const readReport = (filename) => {
  if (!fs.existsSync(filename)) return null;
  const data = JSON.parse(fs.readFileSync(filename, "utf8"));

  // Handle password-protected reports
  if (data.passwordProtected) {
    return { ...data, passwordProtected: true, violations: [] };
  }

  return Array.isArray(data.violations)
    ? data
    : Array.isArray(data)
    ? data[0]
    : null;
};

const impactEmojis = {
  critical: "❗️",
  serious: "⚠️",
  moderate: "🔶",
  minor: "🔷",
  info: "ℹ️",
};

/**
 * Removes pb=0 parameter from URL for display purposes
 * @param {string} url - The URL to clean
 * @returns {string} - The URL without pb=0 parameter
 */
const removePbParam = (url) => {
  if (!url) return url;
  const urlObj = new URL(url);
  urlObj.searchParams.delete("pb");
  const cleaned = urlObj.toString();
  return cleaned.replace(/\?$/, "");
};

const currentReport = readReport("axe-report-preview.json");
const previousReport = readReport("axe-report-default.json");

// Get original URLs from attempted-urls.json for accurate display
let attemptedUrls = {};
try {
  if (fs.existsSync("attempted-urls.json")) {
    attemptedUrls = JSON.parse(fs.readFileSync("attempted-urls.json", "utf8"));
  }
} catch (err) {
  debugLog("Error reading attempted-urls.json", { error: err.message });
}

// Use original URL from attempted-urls if available, otherwise use report URL
const getDisplayUrl = (reportUrl, attemptedUrl) => {
  const urlToUse = attemptedUrl || reportUrl;
  return urlToUse ? removePbParam(urlToUse) : "unknown";
};

debugLog("Report files status", {
  currentReportExists: !!currentReport,
  previousReportExists: !!previousReport,
  currentReportUrl: currentReport?.url,
  previousReportUrl: previousReport?.url,
  attemptedPreviewUrl: attemptedUrls.preview,
  attemptedDefaultUrl: attemptedUrls.default,
  currentReportPasswordProtected: currentReport?.passwordProtected,
  previousReportPasswordProtected: previousReport?.passwordProtected,
});

let output = "### 🧪 Axe Accessibility Report\n\n";

// Check if live URL is password protected first
if (previousReport?.passwordProtected) {
  output += "🔒 Site is password protected.\n\n";
  output +=
    "Accessibility tests cannot be run because the live URL redirects to a password protection page.";
  fs.writeFileSync("axe-comment.md", output);
  console.log("✅ axe-comment.md generated");
  debugLog("Generated comment for password protected live URL", {
    outputLength: output.length,
  });
} else if (!currentReport) {
  console.error("❌ No axe-report-preview.json file found");

  let attemptedUrls = {};
  try {
    if (fs.existsSync("attempted-urls.json")) {
      attemptedUrls = JSON.parse(
        fs.readFileSync("attempted-urls.json", "utf8")
      );
    }
  } catch (err) {
    debugLog("Error reading attempted-urls.json", { error: err.message });
  }

  output += "Preview report was not generated.\n";
  output += "- ❌ Preview report\n";
  if (attemptedUrls.preview) {
    output += `  - URL used: \`${attemptedUrls.preview}\`\n`;
  }
  output +=
    "  - Ensure a preview URL with `preview_theme_id` was included in the PR body\n";
  output += "  - Try rerunning the action\n";
  output +=
    "  - Try making the preview URL more prominent (removing markdown)\n";
  output += "  - Check the action logs for more details\n";

  fs.writeFileSync("axe-comment.md", output);
  console.log("✅ axe-comment.md generated");
  debugLog("Generated comment for missing preview report", {
    outputLength: output.length,
  });
} else {
  const currentViolations = currentReport?.violations
    ? currentReport.violations.flatMap((v) =>
        v.nodes.map((n) => ({
          ...v,
          ...n,
        }))
      )
    : [];

  if (previousReport) {
    const previousViolations = previousReport?.violations
      ? previousReport.violations.flatMap((v) =>
          v.nodes.map((n) => ({
            ...v,
            ...n,
          }))
        )
      : [];

    const newViolations = currentViolations.filter(
      (v) => !previousViolations.some((pv) => pv.id === v.id)
    );

    output += `- ${newViolations.length} new violations found compared to live\n`;
    output += `- ${
      currentViolations.length
    } violations found on the preview url (\`${getDisplayUrl(
      currentReport?.url,
      attemptedUrls.preview
    )}\`)\n`;
    output += `- ${
      previousViolations.length
    } violations found on the live url (\`${getDisplayUrl(
      previousReport?.url,
      attemptedUrls.default
    )}\`)\n`;

    const buildViolationsTable = ({ title, violations }) => {
      if (violations.length === 0) return "";

      let table = "<details>";
      table += `<summary>${title}</summary>\n\n`;
      table += "| Issue | Target | Summary |\n";
      table += "|-------|--------|---------|\n";

      for (const n of violations) {
        const impact = n.impact || "n/a";
        const help = `[${n.help}](${n.helpUrl})`;
        const target = Array.isArray(n.target) ? n.target.join(", ") : "n/a";
        const failureSummary = n.any.map((a) => `- ${a.message}`).join("<br>");

        table += `| ${impactEmojis[impact]} ${help} | \`${target}\` | ${failureSummary} |\n`;
      }

      table += "</details>\n\n";
      return table;
    };

    output += buildViolationsTable({
      title: "⚠️ New violations compared to live",
      violations: sortByImpact(newViolations),
    });

    output += buildViolationsTable({
      title: "🔗 All preview link violations",
      violations: sortByImpact(currentViolations),
    });

    output += buildViolationsTable({
      title: "🧪 All live violations",
      violations: sortByImpact(previousViolations),
    });
  } else {
    output += `- ${
      currentViolations.length
    } violations found on the preview url (\`${getDisplayUrl(
      currentReport?.url,
      attemptedUrls.preview
    )}\`)\n\n`;

    const buildViolationsTable = ({ title, violations }) => {
      if (violations.length === 0) return "";

      let table = "<details>";
      table += `<summary>${title}</summary>\n\n`;
      table += "| Issue | Target | Summary |\n";
      table += "|-------|--------|---------|\n";

      for (const n of violations) {
        const impact = n.impact || "n/a";
        const help = `[${n.help}](${n.helpUrl})`;
        const target = Array.isArray(n.target) ? n.target.join(", ") : "n/a";
        const failureSummary = n.any.map((a) => `- ${a.message}`).join("<br>");

        table += `| ${impactEmojis[impact]} ${help} | \`${target}\` | ${failureSummary} |\n`;
      }

      table += "</details>\n\n";
      return table;
    };

    output += buildViolationsTable({
      title: "🔗 All preview violations",
      violations: sortByImpact(currentViolations),
    });
  }

  fs.writeFileSync("axe-comment.md", output);
  console.log("✅ axe-comment.md generated");
  debugLog("Generated comment for preview report", {
    outputLength: output.length,
    currentViolationsCount: currentViolations.length,
    hasPreviousReport: !!previousReport,
  });
}
