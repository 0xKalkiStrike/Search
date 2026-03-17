from flask import Flask, request, render_template, jsonify
import os
import json
import re
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import openpyxl
import requests
from bs4 import BeautifulSoup
import time

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['RESULTS_FOLDER'] = 'results'

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

if not os.path.exists(app.config['RESULTS_FOLDER']):
    os.makedirs(app.config['RESULTS_FOLDER'])

# Regex for phone and email
phone_regex = re.compile(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b')
email_regex = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')

def setup_driver():
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    # Selenium 4.6+ handles driver management automatically
    driver = webdriver.Chrome(options=options)
    return driver

def search_google(query, num_results=3):
    driver = setup_driver()
    driver.get('https://www.google.com')
    search_box = driver.find_element(By.NAME, 'q')
    search_box.send_keys(query)
    search_box.submit()
    WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, 'search')))
    results = driver.find_elements(By.CSS_SELECTOR, 'div.g a')[:num_results]
    links = [result.get_attribute('href') for result in results if result.get_attribute('href')]
    driver.quit()
    return links

def scrape_site(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        text = soup.get_text()
        phones = phone_regex.findall(text)
        emails = email_regex.findall(text)
        return list(set(phones)), list(set(emails))
    except:
        return [], []

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'})
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'})
    if not file.filename.endswith('.xlsx'):
        return jsonify({'error': 'Please upload an Excel file (.xlsx)'})
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)
    
    # Read Excel
    wb = openpyxl.load_workbook(filepath)
    sheet = wb.active
    names = [cell.value for cell in sheet['A'] if cell.value]  # Assume names in column A
    
    results = {}
    for name in names:
        links = search_google(name)
        phones = []
        emails = []
        for link in links:
            p, e = scrape_site(link)
            phones.extend(p)
            emails.extend(e)
            time.sleep(1)  # Delay to avoid being blocked
        results[name] = {'phones': list(set(phones)), 'emails': list(set(emails))}
    
    # Save to JSON
    results_file = os.path.join(app.config['RESULTS_FOLDER'], 'results.json')
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=4)
    
    return render_template('results.html', results=results)

if __name__ == '__main__':
    app.run(debug=True)