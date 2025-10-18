// This script is designed to be run directly by Node.js in GitHub Actions.
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

// --- Environment Variables ---
// These are provided by the GitHub Actions workflow secrets
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
  // ENHANCED LOGGING: Announce the start of the script.
  console.log("--- Starting Daily Sports News Scraper ---");

  try {
    // --- STEP 1: Scrape the main news page for article links ---
    const urlToScrape = 'https://www.espn.com/news/';
    const scrapingbeeUrl = 'https://app.scrapingbee.com/api/v1/';
    
    console.log(`[1/4] Fetching main news page: ${urlToScrape}`);
    
    const { data: pageData } = await axios.get(scrapingbeeUrl, {
      params: { 'api_key': scrapingbeeApiKey, 'url': urlToScrape }
    });
    
    console.log("    -> Main page fetched successfully.");

    const $ = cheerio.load(pageData);
    const newsLinks = [];
    // This HTML selector is fragile and might change.
    $('article.story-package-module a.contentItem__content').each((i, el) => {
      if (newsLinks.length < 5) {
        const url = $(el).attr('href');
        if (url && !url.startsWith('http')) {
            newsLinks.push(`https://www.espn.com${url}`);
        }
      }
    });

    // ENHANCED LOGGING: Report how many links were found. This is a critical checkpoint.
    console.log(`[2/4] Found ${newsLinks.length} article links to process.`);

    // DEBUGGING CHECK: If no links were found, the website structure has changed.
    if (newsLinks.length === 0) {
      console.warn("    -> WARNING: No article links were found. The HTML selector for the main page is likely broken. Stopping script.");
      // We don't need to throw an error, just stop gracefully.
      return; 
    }

    // --- STEP 2: Process each article link ---
    console.log("[3/4] Processing each article for scraping and summarization...");
    const summarizedNews = [];
    for (const link of newsLinks) {
      try {
        console.log(`\n    -> Processing article: ${link}`);
        
        // Scrape individual article content
        const { data: articleData } = await axios.get(scrapingbeeUrl, {
          params: { 'api_key': scrapingbeeApiKey, 'url': link }
        });
        
        const article$ = cheerio.load(articleData);
        // These HTML selectors are also fragile and might change.
        const title = article$('header.article-header h1').text().trim();
        const articleText = article$('div.article-body p').text().trim();

        // DEBUGGING CHECK: Did we successfully extract the title and text?
        if (title && articleText) {
          console.log(`       - Content extracted successfully. Title: "${title}"`);
          
          // Summarize with Gemini
          const prompt = `Summarize the following sports news article in two sentences: "${articleText}"`;
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const summary = response.text();
          
          summarizedNews.push({ title, url: link, summary });
          console.log("       - Summarization successful.");

        } else {
          // ENHANCED LOGGING: If extraction failed, report it specifically.
          console.warn(`       - WARNING: Failed to extract title or content from this article. The HTML selectors may be broken for this page.`);
          console.warn(`         - Title found: "${title}" (Is this empty?)`);
          console.warn(`         - Article Text found: (length: ${articleText.length}) (Is this 0?)`);
        }

      } catch (articleError) {
        // ENHANCED LOGGING: Catch errors for individual articles but don't stop the whole script.
        console.error(`       - ERROR: An error occurred while processing this article. Skipping it.`, articleError.message);
      }
    }

    // --- STEP 3: Save the results to Supabase ---
    console.log(`\n[4/4] Attempting to save ${summarizedNews.length} summarized articles to Supabase...`);
    if (summarizedNews.length > 0) {
      const { error } = await supabase.from('sports_news').upsert(summarizedNews, { onConflict: 'url' });
      if (error) {
        // Make sure to log the specific Supabase error
        console.error("    -> ERROR: Failed to save data to Supabase.", error);
      } else {
        console.log("    -> Successfully saved data to Supabase.");
      }
    } else {
      console.warn("    -> No new articles to save.");
    }

  } catch (error) {
    // ENHANCED LOGGING: This is the main catch block for critical failures.
    console.error("\n--- A CRITICAL ERROR OCCURRED ---");
    // Axios errors are special. They contain lots of useful info. Let's check for it.
    if (error.isAxiosError) {
      console.error("This was an Axios (networking) error.");
      console.error(`Status Code: ${error.response?.status}`);
      console.error(`Error Message: ${error.message}`);
    } else {
      // For any other type of error
      console.error("An unexpected error occurred:", error);
    }
    process.exit(1); // Exit with an error code to make the GitHub Action fail clearly.
  } finally {
    // ENHANCED LOGGING: Announce the end of the script, regardless of success or failure.
    console.log("\n--- Script finished. ---");
  }
}

// Run the main function
runScraper();
