// This script is designed to be run directly by Node.js in GitHub Actions.
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

// --- Environment Variables ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;

// --- Client Initializations ---
const supabase = createClient(supabaseUrl, supabaseKey);
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

// --- Main Scraper Function ---
async function runScraper() {
  console.log("--- Starting Search-Based Sports News Scraper ---");

  try {
    // --- STEP 1: Perform a Google search for the news ---
    const searchQuery = "top 5 sports news";
    const scrapingbeeUrl = 'https://app.scrapingbee.com/api/v1/';
    
    console.log(`[1/4] Performing Google search for: "${searchQuery}"`);
    
    // To perform a search, we tell ScrapingBee to use Google.
    // The 'search_for' parameter is specific to ScrapingBee.
    const { data: searchResultsPage } = await axios.get(scrapingbeeUrl, {
      params: {
        'api_key': scrapingbeeApiKey,
        'search_for': searchQuery,
        'nb_results': '10' // Ask for a few more results in case some are not news articles
      }
    });
    
    console.log("    -> Google search completed successfully.");

    const $ = cheerio.load(searchResultsPage);
    const newsLinks = [];
    
    // Google's organic search results are typically in a div with id="organic-results"
    // We look for all links (<a>) within elements that have a <h3> tag.
    $('#organic-results a:has(h3)').each((i, el) => {
        // We only want the top 5 valid news links
        if (newsLinks.length < 5) {
            const url = $(el).attr('href');
            // We only want valid, absolute URLs that are not from Google itself.
            if (url && url.startsWith('http') && !url.includes('google.com')) {
                newsLinks.push(url);
            }
        }
    });

    console.log(`[2/4] Found ${newsLinks.length} valid article links from search results.`);

    if (newsLinks.length === 0) {
      console.warn("    -> WARNING: No valid article links found in Google search results. The structure of Google's results page may have changed. Stopping script.");
      return; 
    }

    // --- STEP 2: Process each article link ---
    console.log("[3/4] Processing each article for scraping and summarization...");
    const summarizedNews = [];
    for (const link of newsLinks) {
      try {
        console.log(`\n    -> Processing article: ${link}`);
        
        // Scrape individual article content using ScrapingBee
        const { data: articleData } = await axios.get(scrapingbeeUrl, {
          params: { 'api_key': scrapingbeeApiKey, 'url': link }
        });
        
        const article$ = cheerio.load(articleData);
        
        // GENERIC SELECTORS: These are more likely to work on different news sites.
        // We first try to get a specific article title, but fall back to the general page title.
        const title = (article$('h1').first().text() || article$('title').text()).trim();
        // We combine the text from all paragraph tags (<p>) to form the article body.
        const articleText = article$('p').text().trim();

        if (title && articleText) {
          console.log(`       - Content extracted successfully. Title: "${title}"`);
          
          const prompt = `Summarize the following sports news article in two sentences: "${articleText}"`;
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const summary = response.text();
          
          summarizedNews.push({ title, url: link, summary });
          console.log("       - Summarization successful.");

        } else {
          console.warn(`       - WARNING: Failed to extract title or content from this article.`);
        }

      } catch (articleError) {
        console.error(`       - ERROR: An error occurred while processing this article. Skipping it.`, articleError.message);
      }
    }

    // --- STEP 3: Save the results to Supabase ---
    console.log(`\n[4/4] Attempting to save ${summarizedNews.length} summarized articles to Supabase...`);
    if (summarizedNews.length > 0) {
      const { error } = await supabase.from('sports_news').upsert(summarizedNews, { onConflict: 'url' });
      if (error) {
        console.error("    -> ERROR: Failed to save data to Supabase.", error);
      } else {
        console.log("    -> Successfully saved data to Supabase.");
      }
    } else {
      console.warn("    -> No new articles to save.");
    }

  } catch (error) {
    console.error("\n--- A CRITICAL ERROR OCCURRED ---");
    if (error.isAxiosError) {
      console.error("This was an Axios (networking) error.");
      console.error(`Status Code: ${error.response?.status}`);
      console.error(`Error Message: ${error.message}`);
    } else {
      console.error("An unexpected error occurred:", error);
    }
    process.exit(1);
  } finally {
    console.log("\n--- Script finished. ---");
  }
}

// Run the main function
runScraper();
