import axios from 'axios';
import { parse } from 'csv-parse';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

config();

class LLMReviewClassifier {
  constructor() {
    this.apiKey = process.env.LLM_API_KEY;
    this.baseUrl = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
    this.model = process.env.LLM_MODEL || 'qwen/qwen-turbo';
    this.provider = process.env.LLM_PROVIDER || 'openrouter';
    
    if (!this.apiKey) {
      throw new Error('LLM_API_KEY не найден');
    }
  }

  async readCSV(filePath) {
    return new Promise((resolve, reject) => {
      const fileContent = readFileSync(filePath, 'utf-8');
      
      parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      }, (err, records) => {
        if (err) {
          reject(new Error(`Ошибка при чтении CSV: ${err.message}`));
        } else {
          resolve(records);
        }
      });
    });
  }

  createPrompt(reviewText) {
    return {
      model: this.model,
      messages: [
        {
          role: "system",
          content: `Твоя задача проанализировать отзывы, которые тебе отправляются и вернуть строго файл JSON формата! Он должен выглядеть следующим виде образом:
          {
            "sentiment": "positive/negative/neutral",
            "topic": "категория товара или сервиса",
            "confidence": 0.0 до 1.0,
            "key_points": ["ключевой момент 1", "ключевой момент 2"]
          }
          Не добавляй лишнии комментарии! Не добавляй лишнее, что не входит в данный формат, строго по заданному шаблону!  
          `
        },
        {
          role: "user",
          content: `Проанализируй следующий отзыв и верни JSON:\n\n"${reviewText}"`
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    };
  }

  async sendToLLM(reviewText, reviewId) {
    try {
      console.log(`Обработка отзыва #${reviewId}: "${reviewText.substring(0, 50)}"`);
      
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        this.createPrompt(reviewText),
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000
        }
      );

      const llmResponse = response.data.choices[0].message.content;
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(llmResponse);
      } catch (parseError) {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Не удалось извлечь JSON из ответа LLM');
        }
      }

      return {
        id: reviewId,
        original_text: reviewText,
        analysis: parsedResponse,
        model_used: this.model,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Ошибка при обработке отзыва #${reviewId}:`, error.message);
      
      return {
        id: reviewId,
        original_text: reviewText,
        analysis: {
          sentiment: "error",
          topic: "unknown",
          confidence: 0,
          key_points: ["Ошибка обработки"]
        },
        error: error.message,
        model_used: this.model,
        timestamp: new Date().toISOString()
      };
    }
  }

  saveResults(results, outputPath) {
    const output = {
      pipeline_info: {
        provider: this.provider,
        model: this.model,
        total_reviews: results.length,
        processed_at: new Date().toISOString()
      },
      results: results
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\nРезультаты сохранены в ${outputPath}`);
  }

  async runPipeline(inputCSV, outputJSON) {
    try {
      console.log('Запуск пайплайна классификации отзывов\n');
      console.log('Чтение входных данных');
      const reviews = await this.readCSV(inputCSV);
      console.log(`Загружено ${reviews.length} отзывов\n`);
      
      const results = [];
      for (const review of reviews) {
        const result = await this.sendToLLM(review.review_text, review.id);
        results.push(result);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      this.saveResults(results, outputJSON);
     
      const sentiments = results.map(r => r.analysis.sentiment);
      const stats = {
        positive: sentiments.filter(s => s === 'positive').length,
        negative: sentiments.filter(s => s === 'negative').length,
        neutral: sentiments.filter(s => s === 'neutral').length,
        error: sentiments.filter(s => s === 'error').length
      };
      
      console.log('\nСтатистика анализа:');
      console.log(`Позитивные: ${stats.positive}`);
      console.log(`Негативные: ${stats.negative}`);
      console.log(`Нейтральные: ${stats.neutral}`);
      console.log(`Ошибки: ${stats.error}`);
      
      console.log('\nПайплайн успешно завершен');
      
    } catch (error) {
      console.error('Критическая ошибка пайплайна:', error.message);
      process.exit(1);
    }
  }
}

const classifier = new LLMReviewClassifier();
classifier.runPipeline('reviews.csv', 'analysis_res.json');