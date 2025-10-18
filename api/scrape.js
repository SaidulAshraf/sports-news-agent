const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

module.exports = async (req, res) => {
  try {
    const urlToScrape = 'https://www.espn.com/latest/';
    const scrapingbeeUrl = 'https://app.scrapingbee.com/api/v1/';

    const { data: pageData } = await axios.get(scrapingbeeUrl, {
      params: { 'api_key': process.env.SCRAPINGBEE_API_KEY, 'url': urlToScrape }
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

    const summarizedNews = [];
    for (const link of newsLinks) {
      try {
        const { data: articleData } = await axios.get(scrapingbeeUrl, {
          params: { 'api_key': process.env.SCRAPINGBEE_API_KEY, 'url': link }
        });

        const article$ = cheerio.load(articleData);
        const title = article$('header.article-header h1').text();
        const articleText = article$('div.article-body p').text();

        if (title && articleText) {
          const prompt = `Summarize the following sports news article in two sentences: "${articleText}"`;
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const summary = response.text();

          summarizedNews.push({ title: title, url: link, summary: summary });
        }
      } catch (articleError) {
          console.error(`Failed to process article: ${link}`, articleError.message);
      }
    }

    if (summarizedNews.length > 0) {
      const { error } = await supabase.from('sports_news').insert(summarizedNews);
      if (error) throw error;
    }

    res.status(200).send({ message: 'Scraping and summarization with Gemini successful!', data: summarizedNews });
  } catch (error) {
    console.error('Error in the main process:', error);
    res.status(500).send({ message: 'Process failed', error: error.message });
  }
};
