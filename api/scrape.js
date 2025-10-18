// This script is designed to be run directly by Node.js in GitHub Actions.
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

// These environment variables are provided by the GitHub Actions workflow secrets
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

async function runScraper() {
  try {
    console.log("Starting to scrape the main news page...");
    const urlToScrape = 'https://www.espn.com/latest/';
    const scrapingbeeUrl = 'https://app.scrapingbee.com/api/v1/';

    const { data: pageData } = await axios.get(scrapingbeeUrl, {
      params: { 'api_key': scrapingbeeApiKey, 'url': urlToScrape }
    });

    const $ = cheerio.load(pageData);
    const newsLinks = [];
    $('article.story-package-module a.contentItem__content').each((i, el) => {
      if (newsLinks.length < 5) {
        const url = $(el).attr('href');
        if (url && !url.startsWith('http')) {
            newsLinks.push(`https://www.espn.com${url}`);
        }
      }
    });

    console.log(`Found ${newsLinks.length} article links to process.`);
    const summarizedNews = [];
    for (const link of newsLinks) {
      try {
        console.log(`Processing article: ${link}`);
        const { data: articleData } = await axios.get(scrapingbeeUrl, {
          params: { 'api_key': scrapingbeeApiKey, 'url': link }
        });

        const article$ = cheerio.load(articleData);
        const title = article$('header.article-header h1').text();
        const articleText = article$('div.article-body p').text();

        if (title && articleText) {
          const prompt = `Summarize the following sports news article in two sentences: "${articleText}"`;
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const summary = response.text();

          summarizedNews.push({ title, url: link, summary });
          console.log(`Successfully summarized: ${title}`);
        }
      } catch (articleError) {
          console.error(`Failed to process article: ${link}`, articleError.message);
      }
    }

    if (summarizedNews.length > 0) {
      console.log(`Saving ${summarizedNews.length} new articles to Supabase...`);
      // Using 'upsert' to avoid duplicate entries based on the URL
      const { error } = await supabase.from('sports_news').upsert(summarizedNews, { onConflict: 'url' });
      if (error) {
        console.error("Error saving to Supabase:", error);
      } else {
        console.log("Successfully saved data to Supabase.");
      }
    }
  } catch (error) {
    console.error('A critical error occurred in the main process:', error);
    process.exit(1); // Exit with an error code to make the GitHub Action fail
  }
}

// Run the main function
runScraper();
