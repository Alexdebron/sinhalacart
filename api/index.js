const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://sinhalacartoons.com";

// Search movies by keyword
app.get("/api/search", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      status: "error",
      message: "Please provide a search query. Usage: /api/search?q=movie_name",
    });
  }

  try {
    const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(q)}`, {
      timeout: 15000,
    });
    const $ = cheerio.load(data);

    const results = [];

    $(".search-result-item, .movie-card, article, .post-card").each((i, el) => {
      const linkTag = $(el).find("a").first();
      const title = $(el).find("h2, h3, .entry-title").text().trim() || linkTag.attr("title") || linkTag.text().trim();
      const link = linkTag.attr("href") || "";
      const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || "";
      const quality = $(el).find(".quality, .badge").first().text().trim() || "";
      const imdb = $(el).find(".imdb, .rating").first().text().trim() || "";

      if (link && link.includes("sinhalacartoons.com") && title) {
        results.push({
          title: title.replace(/\s+/g, " ").trim(),
          link,
          image,
          quality,
          imdb,
        });
      }
    });

    if (results.length === 0) {
      $("a[href*='sinhalacartoons.com/']").each((i, el) => {
        const link = $(el).attr("href");
        const title = $(el).text().trim() || $(el).attr("title") || "";

        if (
          link &&
          title &&
          !link.includes("/category/") &&
          !link.includes("/about") &&
          !link.includes("/contact") &&
          !link.includes("/dmca") &&
          !link.includes("/?s=") &&
          link !== BASE_URL &&
          link !== BASE_URL + "/" &&
          title.length > 3
        ) {
          if (!results.find((r) => r.link === link)) {
            const parent = $(el).parent();
            const image = parent.find("img").attr("src") || $(el).find("img").attr("src") || "";
            results.push({
              title: title.replace(/\s+/g, " ").trim(),
              link,
              image,
            });
          }
        }
      });
    }

    if (results.length === 0) {
      return res.json({
        status: "success",
        message: "No results found for your search query.",
        query: q,
        results: [],
      });
    }

    res.json({
      status: "success",
      query: q,
      count: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to search: ${error.message}`,
    });
  }
});

// Get movie details and download links
app.get("/api/movie", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      status: "error",
      message: "Please provide a movie URL. Usage: /api/movie?url=https://sinhalacartoons.com/movie-slug/",
    });
  }

  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    const $ = cheerio.load(data);

    const title = $("h1").first().text().trim();

    const details = {};
    $("li, .meta-item, .movie-info li").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("Director:")) details.director = text.replace("Director:", "").trim();
      if (text.includes("Release Year:")) details.release_year = text.replace("Release Year:", "").trim();
      if (text.includes("IMDb Rating:")) details.imdb_rating = text.replace("IMDb Rating:", "").replace("⭐", "").trim();
      if (text.includes("Quality:")) details.quality = text.replace("Quality:", "").trim();
    });

    let description = "";
    const descSection = $("h2:contains('Description')").next("p");
    if (descSection.length) {
      description = descSection.text().trim();
    }
    if (!description) {
      const contentParagraphs = [];
      $(".entry-content p, .movie-description p, .description p, article p").each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 20 && !text.includes("Click") && !text.includes("redirect")) {
          contentParagraphs.push(text);
        }
      });
      description = contentParagraphs.join("\n\n");
    }

    const cast = [];
    $(".cast-item, .cast-member").each((i, el) => {
      const name = $(el).find("h4, .cast-name, strong").text().trim();
      const role = $(el).find("p, .cast-role, span").last().text().trim();
      const image = $(el).find("img").attr("src") || "";
      if (name) {
        cast.push({ name, role, image });
      }
    });

    const screenshots = [];
    $("img").each((i, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      const alt = $(el).attr("alt") || "";
      if (alt.toLowerCase().includes("screenshot") || src.includes("screenshot") || src.includes("Screen")) {
        screenshots.push(src);
      }
    });

    const downloadLinks = [];
    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();

      if (
        href.includes("page_id=16") ||
        href.includes("download") ||
        text.toLowerCase().includes("download") ||
        text.toLowerCase().includes("direct")
      ) {
        let actualUrl = href;
        let type = "unknown";

        if (href.includes("bulk=")) {
          const bulkMatch = href.match(/bulk=([^&]+)/);
          if (bulkMatch) {
            try {
              actualUrl = Buffer.from(bulkMatch[1], "base64").toString("utf-8");
            } catch (e) {
              actualUrl = href;
            }
          }
        }

        if (href.includes("type=direct") || text.toLowerCase().includes("direct")) {
          type = "direct";
        } else if (href.includes("type=telegram") || text.toLowerCase().includes("telegram")) {
          type = "telegram";
        }

        if (href && !downloadLinks.find((d) => d.actual_url === actualUrl)) {
          downloadLinks.push({
            label: text.replace(/\s+/g, " ").trim(),
            page_url: href,
            actual_url: actualUrl,
            type,
          });
        }
      }
    });

    const poster =
      $(".movie-poster img, .poster img, .featured-image img").attr("src") ||
      $("article img, .entry-content img").first().attr("src") ||
      "";

    res.json({
      status: "success",
      movie: {
        title,
        poster,
        details,
        description,
        cast: cast.length > 0 ? cast : undefined,
        screenshots: screenshots.length > 0 ? screenshots : undefined,
        download_links: downloadLinks,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to get movie details: ${error.message}`,
    });
  }
});

// Get latest movies from homepage
app.get("/api/latest", async (req, res) => {
  try {
    const { data } = await axios.get(BASE_URL, { timeout: 15000 });
    const $ = cheerio.load(data);

    const movies = [];

    $(".hero-slide, .swiper-slide, .slide-item").each((i, el) => {
      const title = $(el).find("h1, h2, h3").first().text().trim();
      const link = $(el).find("a[href*='sinhalacartoons.com/']").attr("href") || "";
      const description = $(el).find("p, .description").first().text().trim();
      const imdb = $(el).find(".imdb, .rating, span:contains('IMDb')").text().trim();
      const year = $(el).find(".year, span:contains('20')").text().trim();
      const category = $(el).find(".category, .badge").text().trim();

      if (title && link) {
        movies.push({
          title,
          link,
          description: description || undefined,
          imdb: imdb || undefined,
          year: year || undefined,
          category: category || undefined,
        });
      }
    });

    if (movies.length === 0) {
      $("a[href*='sinhalacartoons.com/']").each((i, el) => {
        const link = $(el).attr("href");
        const title = $(el).find("h1, h2, h3").text().trim() || $(el).text().trim();

        if (
          link &&
          title &&
          title.length > 5 &&
          !link.includes("/category/") &&
          !link.includes("/about") &&
          !link.includes("/contact") &&
          !link.includes("/dmca") &&
          link !== BASE_URL &&
          link !== BASE_URL + "/"
        ) {
          if (!movies.find((m) => m.link === link)) {
            movies.push({ title: title.replace(/\s+/g, " ").trim(), link });
          }
        }
      });
    }

    res.json({
      status: "success",
      count: movies.length,
      movies,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to fetch latest movies: ${error.message}`,
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Sinhala Cartoons Scraper API",
    endpoints: {
      search: "GET /api/search?q=movie_name - Search for movies",
      movie_details: "GET /api/movie?url=https://sinhalacartoons.com/movie-slug/ - Get movie details & download links",
      latest: "GET /api/latest - Get latest movies from homepage",
    },
  });
});

// Local එකේ test කරන්න විතරක් listen එක දාන්න (Vercel production එකේදී මේක run වෙන්නේ නෑ)
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
}

// Vercel එකට app එක export කරන්න
module.exports = app;
