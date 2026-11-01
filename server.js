
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const FACTCHECK_API_KEY = process.env.GOOGLE_FACTCHECK_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ======================================
// 1. GOOGLE FACT CHECK API
// ======================================

async function getFactCheckReviews(news) {
    if (!FACTCHECK_API_KEY) {
        console.log("Fact Check API key missing.");
        return [];
    }

    try {
        const apiURL = new URL(
            "https://factchecktools.googleapis.com/v1alpha1/claims:search"
        );

        apiURL.searchParams.set("query", news);
        apiURL.searchParams.set("languageCode", "en");
        apiURL.searchParams.set("pageSize", "5");
        apiURL.searchParams.set("key", FACTCHECK_API_KEY);

        const response = await fetch(apiURL);
        const data = await response.json();

        if (!response.ok) {
            console.error("Fact Check API Error:", data.error);
            return [];
        }

        return (data.claims || []).flatMap(claim =>
            (claim.claimReview || []).map(review => ({
                claim: claim.text || "",
                publisher: review.publisher?.name || "Unknown",
                rating: review.textualRating || "Not rated",
                title: review.title || "Fact Check Review",
                url: review.url || "",
                date: review.reviewDate || ""
            }))
        );

    } catch (error) {
        console.error("Fact Check Error:", error.message);
        return [];
    }
}

// ======================================
// 2. CHECK REVIEW RELEVANCE
// ======================================

function filterRelevantReviews(news, reviews) {

    const normalize = text =>
        text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(word => word.length > 2);

    const newsWords = new Set(normalize(news));

    return reviews.filter(review => {

        const reviewText = [
            review.claim,
            review.title
        ].join(" ");

        const reviewWords = normalize(reviewText);

        if (reviewWords.length === 0) {
            return false;
        }

        const commonWords = reviewWords.filter(word =>
            newsWords.has(word)
        );

        const similarity =
            commonWords.length / new Set(reviewWords).size;

        return commonWords.length >= 2 && similarity >= 0.20;
    });
}

// ======================================
// 3. GEMINI AI ANALYSIS
// ======================================

async function checkWithGemini(news, reviews) {

    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
        apiKey: GEMINI_API_KEY
    });

    const prompt = `
You are an educational news analysis assistant.

Analyze the following news claim carefully.

NEWS CLAIM:
"${news}"

RELEVANT PUBLISHED FACT-CHECK REVIEWS:
${JSON.stringify(reviews)}

IMPORTANT RULES:

1. Understand exactly what the news claim says.
2. Do not treat unrelated fact-check reviews as evidence.
3. Use published reviews only when they address the same claim.
4. A review about a different event involving the same place or person is NOT relevant.
5. Use your existing knowledge to assess well-established facts.
6. Do not invent sources, dates, events or evidence.
7. Do not pretend that you performed a live internet search.
8. If the claim is a well-established fact, you may classify it as likely_true.
9. If reliable information contradicts a well-established claim, you may classify it as likely_false.
10. If only part of the claim is supported, choose mixed.
11. If you cannot confidently assess the claim, choose unverified.
12. Absence of a fact-check review does not mean the claim is false.
13. Explain the result in simple English.

Return ONLY one valid JSON object.
Do not use Markdown or code fences.

Required format:

{
  "status": "unverified",
  "explanation": "Explain your assessment.",
  "evidence": "Explain what information supports the assessment."
}

Allowed status values:
likely_true
likely_false
mixed
unverified
`;

    const interaction = await ai.interactions.create({
        model: "gemini-3.8-flash",
        input: prompt
    });

    const answer = interaction.output_text;

    if (!answer) {
        throw new Error("Gemini returned an empty response.");
    }

    console.log("Gemini response:", answer);

    // Extract JSON
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");

    if (start === -1 || end === -1) {
        throw new Error("Gemini returned an invalid response.");
    }

    let result;

    try {
        result = JSON.parse(
            answer.substring(start, end + 1)
        );
    } catch (error) {
        throw new Error("Gemini returned invalid JSON.");
    }

    const allowedStatuses = [
        "likely_true",
        "likely_false",
        "mixed",
        "unverified"
    ];

    if (!allowedStatuses.includes(result.status)) {
        result.status = "unverified";
    }

    return {
        status: result.status,
        explanation:
            result.explanation || "No explanation available.",
        evidence:
            result.evidence || "No supporting evidence available."
    };
}

// ======================================
// 4. MAIN NEWS CHECKING ROUTE
// ======================================

app.post("/api/check-news", async (req, res) => {

    try {

        const news = req.body?.news;

        if (
            typeof news !== "string" ||
            news.trim().length < 10
        ) {
            return res.status(400).json({
                error: "Please enter a proper news headline."
            });
        }

        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                error: "Gemini API key is missing. Check your .env file."
            });
        }

        const cleanNews = news.trim();

        console.log("Checking news:", cleanNews);

        // Get published reviews
        const allReviews =
            await getFactCheckReviews(cleanNews);

        // Keep only relevant reviews
        const relevantReviews =
            filterRelevantReviews(cleanNews, allReviews);

        console.log(
            "Relevant reviews found:",
            relevantReviews.length
        );

        // Gemini analysis
        const result = await checkWithGemini(
            cleanNews,
            relevantReviews
        );

        return res.json({

            status: result.status,

            message: "News assessment completed.",

            explanation: result.explanation,

            evidence: result.evidence,

            reviews: relevantReviews,

            disclaimer:
                "This is an AI-assisted assessment based on available information and existing knowledge. It is not a guaranteed fact-check. Please verify important claims using original sources."

        });

    } catch (error) {

        console.error("Server Error:", error);

        const message = error.message || "";

        if (
            error.status === 429 ||
            error.code === "too_many_requests" ||
            message.toLowerCase().includes("quota") ||
            message.toLowerCase().includes("rate limit")
        ) {
            return res.status(429).json({
                error:
                    "Gemini API quota exceeded. Please check your free-tier limits or try again later."
            });
        }

        return res.status(500).json({
            error:
                message || "Something went wrong. Please try again."
        });
    }
});

// ======================================
// 5. START SERVER
// ======================================

app.listen(PORT, () => {

    console.log(
        "Gemini API:",
        GEMINI_API_KEY ? "LOADED" : "MISSING"
    );

    console.log(
        "Fact Check API:",
        FACTCHECK_API_KEY ? "LOADED" : "MISSING"
    );

    console.log(
        `TruthCheck running at http://localhost:${PORT}`
    );

});
