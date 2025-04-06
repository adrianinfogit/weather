document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const VISUAL_CROSSING_API_KEY = 'T6CUCZS4PG4M6A6ST8GXEM44T'; // <-- IMPORTANT: Replace with your key
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY29udGViYXkiLCJhIjoiY205NWd5YmN1MTJhNzJrczg0YWJzeXZzNyJ9.GJ5YvGtTOELqz44Y9u5Rgg';     // <-- IMPORTANT: Replace with your key
    const DEFAULT_LOCATION = { name: 'Frankfurt am Main', lat: 50.1109, lon: 8.6821, id: 'frankfurt_default' }; // Frankfurt
    const HISTORY_KEY = 'weatherAppHistory';
    const MAX_HISTORY_ITEMS = 10;

    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const historySelect = document.getElementById('history-select');
    const statusMessage = document.getElementById('status-message');

    const currentLocationEl = document.getElementById('current-location');
    const currentIconEl = document.getElementById('current-icon');
    const currentTempEl = document.getElementById('current-temp');
    const currentRealfeelEl = document.getElementById('current-realfeel');
    const currentConditionsEl = document.getElementById('current-conditions');

    const hourlyContainer = document.getElementById('hourly-container');
    const dailyContainer = document.getElementById('daily-container');
    // Chart elements
    const dailyTrendChartCtx = document.getElementById('daily-trend-chart')?.getContext('2d'); // Use optional chaining in case canvas isn't found
    let dailyChartInstance = null; // To hold the chart instance

    // --- Application State ---
    let searchHistory = [];

    // --- Initialization ---
    function init() {
        loadHistory();
        updateHistoryDropdown();

        const lastLocation = getLastLocation();
        if (lastLocation) {
            showLoading('Loading weather for last location...');
            fetchWeather(lastLocation.lat, lastLocation.lon, lastLocation.name);
        } else {
            // Try IP lookup first
            showLoading('Getting your location...');
            getLocationByIP()
                .then(ipLocation => {
                    const locationData = { ...ipLocation, id: `ip_${Date.now()}` };
                    showLoading(`Loading weather for ${ipLocation.name}...`);
                    fetchWeather(locationData.lat, locationData.lon, locationData.name, false);
                })
                .catch(err => {
                    console.warn("IP Location failed:", err);
                    showLoading(`Loading weather for default location (${DEFAULT_LOCATION.name})...`);
                    fetchWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name);
                });
        }

        setupEventListeners();
    }

    function setupEventListeners() {
        searchButton.addEventListener('click', handleSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
        historySelect.addEventListener('change', handleHistorySelection);
    }

    // --- Location Handling ---

    function handleSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            showError("Please enter a location to search.");
            return;
        }
        showLoading(`Searching for "${query}"...`);
        geocodeLocation(query);
        searchInput.value = ''; // Clear input after search
    }

    function handleHistorySelection() {
        const selectedId = historySelect.value;
        if (!selectedId) return;

        const selectedLocation = searchHistory.find(loc => loc.id === selectedId);
        if (selectedLocation) {
            showLoading(`Loading weather for ${selectedLocation.name}...`);
            fetchWeather(selectedLocation.lat, selectedLocation.lon, selectedLocation.name);
            moveToTopOfHistory(selectedLocation.id);
        } else {
            showError("Could not find selected location in history.");
        }
    }

    function getLastLocation() {
        return searchHistory.length > 0 ? searchHistory[0] : null;
    }

    // --- API Calls ---

    async function getLocationByIP() {
        try {
            const response = await fetch('https://ip-api.com/json/?fields=status,message,city,lat,lon');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.status !== 'success') {
                throw new Error(data.message || 'Failed to get location from IP');
            }
            return { name: data.city || 'Your Location', lat: data.lat, lon: data.lon };
        } catch (error) {
            console.error("IP Geolocation Error:", error);
            throw error;
        }
    }

    async function geocodeLocation(query) {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1&types=place,postcode,address`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Mapbox Geocoding HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const [lon, lat] = feature.center;
                const name = feature.text || feature.place_name;
                const locationData = { name: name, lat: lat, lon: lon, id: feature.id };
                showLoading(`Loading weather for ${name}...`);
                fetchWeather(lat, lon, name, true);
            } else {
                showError(`Could not find location: "${query}"`);
            }
        } catch (error) {
            console.error("Mapbox Geocoding Error:", error);
            showError("Failed to search for location. Please check your connection or try again.");
        }
    }

    async function fetchWeather(lat, lon, name, saveToHistory = false) {
        const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&key=${VISUAL_CROSSING_API_KEY}&contentType=json&include=current,hours,days`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                let errorMsg = `Visual Crossing API error! status: ${response.status}`;
                try {
                    const errorText = await response.text();
                    errorMsg += ` - ${errorText}`;
                } catch (_) { /* Ignore */ }
                throw new Error(errorMsg);
            }
            const data = await response.json();

            hideStatus();
            displayCurrentWeather(data, name);
            displayHourlyForecast(data.days[0].hours); // API includes <24hr hours in first day entry typically
            displayDailyForecast(data.days);
            displayDailyTrendChart(data.days); // Call chart function

            if (saveToHistory) {
                 // Use a more stable ID if possible, fallback to lat,lon
                 const historyId = data.resolvedAddress || `${lat},${lon}`; // Using resolvedAddress might be better if stable
                 addToHistory({ name: name, lat: lat, lon: lon, id: historyId });
            }

        } catch (error) {
            console.error("Visual Crossing API Error:", error);
            showError("Failed to fetch weather data. Please check your API key, connection, or try again.");
            clearWeatherData();
        }
    }

    // --- Data Display ---

    function displayCurrentWeather(data, name) {
        const current = data.currentConditions;
        currentLocationEl.textContent = name || data.resolvedAddress || 'Current Location';
        currentIconEl.textContent = mapIcon(current.icon);
        currentTempEl.textContent = `${Math.round(current.temp)}°C`;
        currentRealfeelEl.textContent = `Feels like: ${Math.round(current.feelslike)}°C`;
        currentConditionsEl.textContent = current.conditions;
        currentIconEl.setAttribute('aria-label', current.conditions);
        currentIconEl.setAttribute('role', 'img');
    }

    function displayHourlyForecast(hourlyData) {
        hourlyContainer.innerHTML = '';
        const nowEpoch = Date.now() / 1000;
        const relevantHours = hourlyData.filter(hour => hour.datetimeEpoch >= nowEpoch).slice(0, 48);

        relevantHours.forEach(hour => {
            const date = new Date(hour.datetimeEpoch * 1000);
            const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

            const item = document.createElement('div');
            item.className = 'hourly-item';
            item.innerHTML = `
                <div class="hourly-time">${timeString}</div>
                <div class="hourly-icon weather-icon" role="img" aria-label="${hour.conditions}">${mapIcon(hour.icon)}</div>
                <div class="hourly-temp">${Math.round(hour.temp)}°C</div>
                <div class="hourly-realfeel">FL: ${Math.round(hour.feelslike)}°C</div>
                <div class="hourly-precip">💧 ${hour.precipprob !== null ? hour.precipprob : 0}%</div>
                <div class="hourly-precip">${hour.precip !== null ? hour.precip : 0} mm</div>
            `;
            hourlyContainer.appendChild(item);
        });
         // Scroll to the beginning
         hourlyContainer.scrollLeft = 0;
    }

    function displayDailyForecast(dailyData) {
        dailyContainer.innerHTML = ''; // Clear previous forecast
        // Visual Crossing typically returns 15 days
        dailyData.forEach(day => {
            const date = new Date(day.datetimeEpoch * 1000);
            // More concise date format
            const dayString = date.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });

            const item = document.createElement('div');
            item.className = 'daily-item'; // Uses updated CSS for inline-block
            item.innerHTML = `
                <div class="daily-date">${dayString}</div>
                <div class="daily-icon weather-icon" role="img" aria-label="${day.conditions}">${mapIcon(day.icon)}</div>
                <div class="daily-temp">
                    <span class="max" style="color: #ff6384;">${Math.round(day.tempmax)}°</span> / <span class="min" style="color: #36a2eb;">${Math.round(day.tempmin)}°</span>
                </div>
                <div class="daily-precip">💧 ${day.precipprob !== null ? day.precipprob : 0}%</div>
                <div class="daily-precip">${day.precip !== null ? day.precip : 0} mm</div>
            `;
            dailyContainer.appendChild(item);
        });
         // Scroll to the beginning
         dailyContainer.scrollLeft = 0;
    }

    function displayDailyTrendChart(dailyData) {
        if (!dailyTrendChartCtx) {
             console.error("Chart canvas context not found.");
             return;
        }

        // Destroy previous chart instance if it exists
        if (dailyChartInstance) {
            dailyChartInstance.destroy();
            dailyChartInstance = null; // Important to nullify
        }

        // Prepare data for Chart.js
        const labels = dailyData.map(day => new Date(day.datetimeEpoch * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }));
        const maxTemps = dailyData.map(day => day.tempmax);
        const minTemps = dailyData.map(day => day.tempmin);

        // Create the new chart
        dailyChartInstance = new Chart(dailyTrendChartCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Max Temp (°C)',
                        data: maxTemps,
                        borderColor: 'rgb(255, 99, 132)', // Reddish
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1 // Adds a bit of curve
                    },
                    {
                        label: 'Min Temp (°C)',
                        data: minTemps,
                        borderColor: 'rgb(54, 162, 235)', // Bluish
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1 // Adds a bit of curve
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // Allow chart height to be controlled by container
                scales: {
                    y: {
                        beginAtZero: false, // Don't force y-axis to start at 0 for temps
                         ticks: {
                            // Include degrees symbol in ticks
                             callback: function(value) {
                                 return value + '°C';
                             }
                         }
                    }
                },
                 plugins: {
                    tooltip: {
                        mode: 'index', // Show tooltips for both lines at the same index
                        intersect: false,
                         callbacks: {
                            // Customize tooltip labels
                             label: function(context) {
                                 let label = context.dataset.label || '';
                                 if (label) {
                                     label += ': ';
                                 }
                                 if (context.parsed.y !== null) {
                                     label += context.parsed.y + '°C';
                                 }
                                 return label;
                             }
                         }
                    },
                    legend: {
                        position: 'top',
                    },
                }
            }
        });
    }


    function clearWeatherData() {
        currentLocationEl.textContent = '---';
        currentIconEl.textContent = '';
        currentTempEl.textContent = '--°C';
        currentRealfeelEl.textContent = 'Feels like: --°C';
        currentConditionsEl.textContent = '--';
        hourlyContainer.innerHTML = '';
        dailyContainer.innerHTML = '';
        currentIconEl.removeAttribute('aria-label');

        // Destroy the chart if it exists
        if (dailyChartInstance) {
            dailyChartInstance.destroy();
            dailyChartInstance = null;
        }
        // Optionally clear the canvas explicitly, although destroy should handle it
        if(dailyTrendChartCtx) {
            dailyTrendChartCtx.clearRect(0, 0, dailyTrendChartCtx.canvas.width, dailyTrendChartCtx.canvas.height);
        }
    }

    // --- UI Helpers ---

    function showLoading(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message loading';
    }

    function showError(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message error';
    }

    function hideStatus() {
        statusMessage.textContent = '';
        statusMessage.style.display = 'none';
        statusMessage.className = 'status-message';
    }

    function mapIcon(iconCode) {
        const iconMap = {
            'snow': '❄️', 'snow-showers-day': '🌨️', 'snow-showers-night': '🌨️',
            'thunder-rain': '⛈️', 'thunder-showers-day': '⛈️', 'thunder-showers-night': '⛈️',
            'rain': '🌧️', 'showers-day': '🌦️', 'showers-night': '🌦️',
            'fog': '🌫️', 'wind': '💨', 'cloudy': '☁️',
            'partly-cloudy-day': '⛅', 'partly-cloudy-night': '☁️🌙',
            'clear-day': '☀️', 'clear-night': '🌙',
        };
        return iconMap[iconCode] || '❓';
    }

    // --- Local Storage / History ---

    function loadHistory() {
        const storedHistory = localStorage.getItem(HISTORY_KEY);
        searchHistory = storedHistory ? JSON.parse(storedHistory) : [];
    }

    function saveHistory() {
        if (searchHistory.length > MAX_HISTORY_ITEMS) {
            searchHistory = searchHistory.slice(0, MAX_HISTORY_ITEMS);
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory));
        updateHistoryDropdown();
    }

    function addToHistory(locationData) {
         // Prevent duplicates based on ID
        const existingIndex = searchHistory.findIndex(item => item.id === locationData.id);
        if (existingIndex > -1) {
            searchHistory.splice(existingIndex, 1);
        }
        searchHistory.unshift(locationData);
        saveHistory();
    }

     function moveToTopOfHistory(locationId) {
        const index = searchHistory.findIndex(item => item.id === locationId);
        if (index > 0) {
            const [item] = searchHistory.splice(index, 1);
            searchHistory.unshift(item);
            saveHistory();
        }
    }

    function updateHistoryDropdown() {
        historySelect.innerHTML = '<option value="">Select a recent location</option>';
        searchHistory.forEach(location => {
            const option = document.createElement('option');
            option.value = location.id;
            option.textContent = location.name;
            historySelect.appendChild(option);
        });
    }

    // --- Start the App ---
    init();
});
