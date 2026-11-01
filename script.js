async function checkNews() {

    const newsInput = document.getElementById("newsInput");
    const checkBtn = document.getElementById("checkBtn");
    const loading = document.getElementById("loading");
    const result = document.getElementById("result");

    const news = newsInput.value.trim();

    if (news.length < 10) {
        alert("Please enter a proper news headline!");
        return;
    }

    // Show loading message
    result.className = "result hidden";
    loading.textContent = "Checking news with AI and searching for evidence...";
    checkBtn.disabled = true;

    try {

        const response = await fetch("/api/check-news", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                news: news
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Unable to check news.");
        }

        loading.textContent = "";
        result.classList.remove("hidden");

        // Result heading and message
        let title = "";
        let message = "";

        if (data.status === "likely_true") {

            title = "✅ LIKELY TRUE";
            message = "Available evidence supports this news claim.";

        } else if (data.status === "likely_false") {

            title = "❌ LIKELY FALSE";
            message = "Available evidence does not support this news claim.";

        } else if (data.status === "mixed") {

            title = "⚠️ MIXED INFORMATION";
            message = "Some parts of this claim are supported, while others are not.";

        } else {

            title = "🔎 UNVERIFIED NEWS";
            message = "There is not enough reliable evidence to reach a conclusion.";

        }

        result.className = "result " + data.status;

        document.getElementById("resultTitle").textContent = title;
        document.getElementById("resultMessage").textContent = message;

        const reviewList = document.getElementById("reviewList");

        reviewList.replaceChildren();

        // AI Explanation
        if (data.explanation) {

            const explanationCard = document.createElement("div");
            explanationCard.className = "review-card";

            const heading = document.createElement("h3");
            heading.textContent = "AI Explanation";

            const paragraph = document.createElement("p");
            paragraph.textContent = data.explanation;

            explanationCard.append(heading, paragraph);
            reviewList.appendChild(explanationCard);
        }

        // Evidence
        if (data.evidence) {

            const evidenceCard = document.createElement("div");
            evidenceCard.className = "review-card";

            const heading = document.createElement("h3");
            heading.textContent = "Evidence Summary";

            const paragraph = document.createElement("p");
            paragraph.textContent = data.evidence;

            evidenceCard.append(heading, paragraph);
            reviewList.appendChild(evidenceCard);
        }

        // Google Search Sources
        if (data.sources && data.sources.length > 0) {

            const sourceCard = document.createElement("div");
            sourceCard.className = "review-card";

            const heading = document.createElement("h3");
            heading.textContent = "Sources Found";

            sourceCard.appendChild(heading);

            data.sources.forEach(source => {

                if (!source.url) return;

                const link = document.createElement("a");

                link.textContent = source.title || "Read Source";
                link.href = source.url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";

                sourceCard.appendChild(link);

                const line = document.createElement("br");
                sourceCard.appendChild(line);
            });

            reviewList.appendChild(sourceCard);
        }

        // Published Fact Check Reviews
        if (data.reviews && data.reviews.length > 0) {

            const reviewHeading = document.createElement("h3");
            reviewHeading.textContent = "Published Fact-Check Reviews";

            reviewList.appendChild(reviewHeading);

            data.reviews.forEach(review => {

                const card = document.createElement("div");
                card.className = "review-card";

                const heading = document.createElement("h4");
                heading.textContent = review.title;

                const claim = document.createElement("p");
                claim.textContent = "Claim: " + review.claim;

                const rating = document.createElement("p");
                rating.textContent = "Fact-check Rating: " + review.rating;

                const publisher = document.createElement("p");
                publisher.textContent = "Publisher: " + review.publisher;

                card.append(heading, claim, rating, publisher);

                if (review.date) {
                    const date = document.createElement("p");
                    date.textContent = "Review Date: " + review.date;
                    card.appendChild(date);
                }

                if (review.url) {

                    const link = document.createElement("a");

                    link.textContent = "Read Full Fact Check →";
                    link.href = review.url;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";

                    card.appendChild(link);
                }

                reviewList.appendChild(card);
            });
        }

        // AI disclaimer
        const disclaimer = document.createElement("p");
        disclaimer.className = "disclaimer";
        disclaimer.textContent = data.disclaimer ||
            "AI results may be incorrect. Always verify important information using original sources.";

        reviewList.appendChild(disclaimer);

    } catch (error) {

        loading.textContent = "";

        result.className = "result unverified";
        result.classList.remove("hidden");

        document.getElementById("resultTitle").textContent =
            "Unable to Verify";

        document.getElementById("resultMessage").textContent =
            error.message;

        document.getElementById("reviewList").replaceChildren();

    } finally {

        checkBtn.disabled = false;

    }
}