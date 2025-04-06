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
    // const dailyTrendEl = document.getElementById('daily-trend'); // For chart later

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
                     // Use a unique ID for IP location to avoid duplicate history entries if same city is searched
                    const locationData = { ...ipLocation, id: `ip_${Date.now()}` };
                    showLoading(`Loading weather for ${ipLocation.name}...`);
                    fetchWeather(locationData.lat, locationData.lon, locationData.name, false); // Don't save IP loc automatically
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
             // Move selected item to top of history logically (though dropdown order remains)
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
            throw error; // Re-throw to be caught by the caller
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
                const name = feature.text || feature.place_name; // Use text (city name) or full place name
                const locationData = { name: name, lat: lat, lon: lon, id: feature.id }; // Use Mapbox feature id for history uniqueness
                showLoading(`Loading weather for ${name}...`);
                fetchWeather(lat, lon, name, true); // Save searched location to history
            } else {
                showError(`Could not find location: "${query}"`);
            }
        } catch (error) {
            console.error("Mapbox Geocoding Error:", error);
            showError("Failed to search for location. Please check your connection or try again.");
        }
    }

    async function fetchWeather(lat, lon, name, saveToHistory = false) {
        // Use Visual Crossing Timeline API - includes current, hourly, daily
        const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&key=${VISUAL_CROSSING_API_KEY}&contentType=json&include=current,hours,days`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                // Try to get error message from Visual Crossing if available
                 let errorMsg = `Visual Crossing API error! status: ${response.status}`;
                 try {
                     const errorText = await response.text();
                     errorMsg += ` - ${errorText}`;
                 } catch (_) { /* Ignore if can't read body */ }
                throw new Error(errorMsg);
            }
            const data = await response.json();

            hideStatus(); // Hide loading/previous error
            displayCurrentWeather(data, name);
            displayHourlyForecast(data.days[0].hours); // First day contains next 48 hrs relevant data
            displayDailyForecast(data.days);

            if (saveToHistory) {
                // Add/update history only for successful searches/selections initiated by user
                addToHistory({ name: name, lat: lat, lon: lon, id: `${lat},${lon}` }); // Use lat,lon as ID for simple uniqueness check
            }

        } catch (error) {
            console.error("Visual Crossing API Error:", error);
            showError("Failed to fetch weather data. Please check your API key, connection, or try again.");
            // Optionally clear weather display sections on error?
            clearWeatherData();
        }
    }

    // --- Data Display ---

    function displayCurrentWeather(data, name) {
        const current = data.currentConditions;
        currentLocationEl.textContent = name || data.resolvedAddress || 'Current Location';
        currentIconEl.textContent = mapIcon(current.icon); // Use text icon for now
        currentTempEl.textContent = `${Math.round(current.temp)}°C`;
        currentRealfeelEl.textContent = `Feels like: ${Math.round(current.feelslike)}°C`;
        currentConditionsEl.textContent = current.conditions;

         // Set aria-label for accessibility
         currentIconEl.setAttribute('aria-label', current.conditions);
         currentIconEl.setAttribute('role', 'img');
    }

    function displayHourlyForecast(hourlyData) {
        hourlyContainer.innerHTML = ''; // Clear previous forecast
        // Get up to 48 hours from now
        const nowEpoch = Date.now() / 1000;
        const relevantHours = hourlyData.filter(hour => hour.datetimeEpoch >= nowEpoch).slice(0, 48);

        relevantHours.forEach(hour => {
            const date = new Date(hour.datetimeEpoch * 1000);
            const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); // 24hr format

            const item = document.createElement('div');
            item.className = 'hourly-item';
            item.innerHTML = `
                <div class="hourly-time">${timeString}</div>
                <div class="hourly-icon weather-icon" role="img" aria-label="${hour.conditions}">${mapIcon(hour.icon)}</div>
                <div class="hourly-temp">${Math.round(hour.temp)}°C</div>
                <div class="hourly-realfeel">FL: ${Math.round(hour.feelslike)}°C</div>
                <div class="hourly-precip">💧 ${hour.precipprob || 0}%</div>
                <div class="hourly-precip">${hour.precip || 0} mm</div>
            `;
            hourlyContainer.appendChild(item);
        });
    }

    function displayDailyForecast(dailyData) {
        dailyContainer.innerHTML = ''; // Clear previous forecast
        // Visual Crossing typically returns 15 days
        dailyData.forEach(day => {
            const date = new Date(day.datetimeEpoch * 1000);
            const dayString = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

            const item = document.createElement('div');
            item.className = 'daily-item';
            item.innerHTML = `
                <div class="daily-date">${dayString}</div>
                <div class="daily-icon weather-icon" role="img" aria-label="${day.conditions}">${mapIcon(day.icon)}</div>
                <div class="daily-temp">
                    <span class="max">${Math.round(day.tempmax)}°</span> / <span class="min">${Math.round(day.tempmin)}°</span>
                </div>
                <div class="daily-precip">💧 ${day.precipprob || 0}%</div>
                <div class="daily-precip">${day.precip || 0} mm</div>
            `;
            dailyContainer.appendChild(item);
        });

        // Placeholder for trend line chart (needs a library like Chart.js)
        // displayDailyTrendChart(dailyData);
    }

    function displayDailyTrendChart(dailyData) {
         // TODO: Implement chart using a library like Chart.js or similar
         console.log("Daily data for trend chart:", dailyData.map(d => ({ max: d.tempmax, min: d.tempmin })));
         // Example: Get labels (dates) and data (max/min temps)
         // const labels = dailyData.map(day => new Date(day.datetimeEpoch * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }));
         // const maxTemps = dailyData.map(day => day.tempmax);
         // const minTemps = dailyData.map(day => day.tempmin);
         // Use a charting library to render this data on a canvas element inside #daily-trend
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
    }

    // --- UI Helpers ---

    function showLoading(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message loading'; // Use classes for styling
    }

    function showError(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message error';
    }

    function hideStatus() {
        statusMessage.textContent = '';
        statusMessage.style.display = 'none';
         statusMessage.className = 'status-message'; // Reset classes
    }

    function mapIcon(iconCode) {
        // Simple mapping - replace with actual icons (SVG/PNG/Font Class)
        // Based on Visual Crossing recommendations: https://www.visualcrossing.com/resources/documentation/weather-api/defining-icon-set-in-the-weather-api/
        const iconMap = {
            'snow': '❄️',
            'snow-showers-day': '🌨️',
            'snow-showers-night': '🌨️',
            'thunder-rain': '⛈️',
            'thunder-showers-day': '⛈️',
            'thunder-showers-night': '⛈️',
            'rain': '🌧️',
            'showers-day': '🌦️',
            'showers-night': '🌦️',
            'fog': '🌫️',
            'wind': '💨',
            'cloudy': '☁️',
            'partly-cloudy-day': '⛅',
            'partly-cloudy-night': '☁️🌙', // No standard single emoji, combining
            'clear-day': '☀️',
            'clear-night': '🌙',
        };
        return iconMap[iconCode] || '❓'; // Return code or question mark if not found
        // Example for image icons: return `<img src="icons/${iconCode}.svg" alt="${iconCode}">`;
        // Example for Font Awesome: return `<i class="fas fa-${mapToFontAwesome(iconCode)}"></i>`;
    }


    // --- Local Storage / History ---

    function loadHistory() {
        const storedHistory = localStorage.getItem(HISTORY_KEY);
        if (storedHistory) {
            searchHistory = JSON.parse(storedHistory);
        } else {
            searchHistory = [];
        }
    }

    function saveHistory() {
        // Limit history size
        if (searchHistory.length > MAX_HISTORY_ITEMS) {
            searchHistory = searchHistory.slice(0, MAX_HISTORY_ITEMS);
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory));
        updateHistoryDropdown();
    }

    function addToHistory(locationData) {
        // Avoid adding duplicates based on ID (Mapbox ID or lat,lon string)
        const existingIndex = searchHistory.findIndex(item => item.id === locationData.id);
        if (existingIndex > -1) {
            // If exists, remove it to add it to the top later
            searchHistory.splice(existingIndex, 1);
        }

        // Add to the beginning of the array (most recent)
        searchHistory.unshift(locationData);
        saveHistory();
    }

     function moveToTopOfHistory(locationId) {
        const index = searchHistory.findIndex(item => item.id === locationId);
        if (index > 0) { // Only move if not already at the top
            const [item] = searchHistory.splice(index, 1);
            searchHistory.unshift(item);
            saveHistory(); // Save the reordered history
        }
    }


    function updateHistoryDropdown() {
        historySelect.innerHTML = '<option value="">Select a recent location</option>'; // Clear previous options, add default
        searchHistory.forEach(location => {
            const option = document.createElement('option');
            option.value = location.id; // Use unique ID for value
            option.textContent = location.name;
            historySelect.appendChild(option);
        });
    }

    // --- Start the App ---
    init();
});