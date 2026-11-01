
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const FACTCHECK_API_KEY = process.env.GOOGLE_FACTCHECK_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(express.json());
app.use(express.static(__dirname));

// ======================================
// 1. GOOGLE FACT CHECK API
// ======================================

async function getFactCheckReviews(news) {
    if (!FACTCHECK_API_KEY) return [];

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
// 2. FILTER RELEVANT REVIEWS
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

        if (reviewWords.length === 0) return false;

        const commonWords = reviewWords.filter(word =>
            newsWords.has(word)
        );

        const similarity =
            commonWords.length / new Set(reviewWords).size;

        return commonWords.length >= 2 && similarity >= 0.20;
    });
}

// ======================================
// 3. GROQ AI ANALYSIS
// ======================================

async function checkWithGroq(news, reviews) {
    if (!GROQ_API_KEY) {
        throw new Error("Groq API key is missing. Check Render Environment.");
    }

    const prompt = `
You are an educational news verification assistant.

Analyze this news claim carefully:

NEWS CLAIM:
"${news}"

PUBLISHED FACT-CHECK REVIEWS:
${JSON.stringify(reviews)}

RULES:
1. Analyze the exact claim.
2. Use relevant published fact-check reviews as evidence.
3. Do not invent facts, sources or events.
4. Do not claim to have performed a live internet search.
5. If reliable evidence supports the claim, use likely_true.
6. If reliable evidence contradicts the claim, use likely_false.
7. If only some parts are correct, use mixed.
8. If evidence is insufficient, use unverified.
9. No fact-check result does not mean the news is false.
10. Explain in simple English.

Return ONLY valid JSON in this format:

{
  "status": "unverified",
  "explanation": "Explain your assessment.",
  "evidence": "Explain the available evidence."
}

Allowed status values:
likely_true
likely_false
mixed
unverified
`;

    const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 700
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error("Groq API Error:", data);
        const error = new Error(
            data.error?.message || "Groq API request failed."
        );
        error.status = response.status;
        throw error;
    }

    const answer =
        data.choices?.[0]?.message?.content;

    if (!answer) {
        throw new Error("Groq returned an empty response.");
    }

    console.log("Groq response:", answer);

    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");

    if (start === -1 || end === -1) {
        throw new Error("AI returned an invalid response.");
    }

    let result;

    try {
        result = JSON.parse(answer.substring(start, end + 1));
    } catch {
        throw new Error("AI returned invalid JSON.");
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
        explanation: result.explanation ||
            "No explanation available.",
        evidence: result.evidence ||
            "No supporting evidence available."
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

        if (!GROQ_API_KEY) {
            return res.status(500).json({
                error: "Groq API key is missing. Check Render Environment."
            });
        }

        const cleanNews = news.trim();

        console.log("Checking news:", cleanNews);

        const allReviews =
            await getFactCheckReviews(cleanNews);

        const relevantReviews =
            filterRelevantReviews(cleanNews, allReviews);

        console.log(
            "Relevant reviews found:",
            relevantReviews.length
        );

        const result = await checkWithGroq(
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
                "This is an AI-assisted assessment, not a guaranteed fact-check. Verify important claims using reliable original sources."
        });

    } catch (error) {
        console.error("Server Error:", error);

        if (
            error.status === 429 ||
            error.message.toLowerCase().includes("rate limit")
        ) {
            return res.status(429).json({
                error: "Groq API limit reached. Please try again later."
            });
        }

        return res.status(500).json({
            error: error.message ||
                "Something went wrong. Please try again."
        });
    }
});

// ======================================
// 5. START SERVER
// ======================================

app.listen(PORT, () => {
    console.log(
        "Groq API:",
        GROQ_API_KEY ? "LOADED" : "MISSING"
    );

    console.log(
        "Fact Check API:",
        FACTCHECK_API_KEY ? "LOADED" : "MISSING"
    );

    console.log(`TruthCheck running on port ${PORT}`);
});
