document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const VISUAL_CROSSING_API_KEY = 'T6CUCZS4PG4M6A6ST8GXEM44T'; // <-- IMPORTANT: Replace with your key
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY29udGViYXkiLCJhIjoiY205NWd5YmN1MTJhNzJrczg0YWJzeXZzNyJ9.GJ5YvGtTOELqz44Y9u5Rgg';     // <-- IMPORTANT: Replace with your key
    const DEFAULT_LOCATION = { name: 'Frankfurt am Main', lat: 50.1109, lon: 8.6821, id: 'frankfurt_default' }; // Frankfurt
    const HISTORY_KEY = 'weatherAppHistory';
    const MAX_HISTORY_ITEMS = 10;

    // --- Register Chart.js Plugins ---
    // Check if ChartDataLabels is loaded before registering
    if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
        // Default config for labels (can be overridden per chart)
        // Chart.defaults.set('plugins.datalabels', {
        //     color: '#36A2EB'
        // });
    } else {
        console.warn('ChartDataLabels plugin not loaded. Labels will not be displayed on the chart.');
    }


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
    const dailyTrendChartCtx = document.getElementById('daily-trend-chart')?.getContext('2d');
    let dailyChartInstance = null;

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
            showLoading('Getting your location...');
            getLocationByIP()
                .then(ipLocation => {
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
            // Ensure lat/lon are numbers
            const lat = parseFloat(data.lat);
            const lon = parseFloat(data.lon);
            if (isNaN(lat) || isNaN(lon)) {
                 throw new Error('Invalid coordinates received from IP API');
            }
            return { name: data.city || 'Your Location', lat: lat, lon: lon };
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
                const name = feature.text || feature.place_name || query; // Use query as fallback name
                 if (typeof lat !== 'number' || typeof lon !== 'number') {
                    throw new Error('Invalid coordinates received from Mapbox');
                 }
                // Use feature.id if available and unique, otherwise fallback
                const locationId = feature.id || `${lat.toFixed(4)},${lon.toFixed(4)}`;
                const locationData = { name: name, lat: lat, lon: lon, id: locationId };
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
        // Validate coordinates
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
             console.error(`Invalid coordinates for fetchWeather: lat=${lat}, lon=${lon}`);
             showError("Invalid location coordinates provided.");
             return;
         }

        const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&key=${VISUAL_CROSSING_API_KEY}&contentType=json&include=current,hours,days`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                let errorMsg = `Weather API error! status: ${response.status}`;
                 try {
                     // Try to parse error response from Visual Crossing for more details
                     const errorData = await response.json();
                     errorMsg += ` - ${errorData.message || response.statusText}`;
                 } catch (_) {
                     // Fallback if response is not JSON or reading fails
                     errorMsg += ` - ${response.statusText}`;
                 }
                throw new Error(errorMsg);
            }
            const data = await response.json();

            // Basic validation of received data
            if (!data || !data.currentConditions || !data.days || !data.days.length > 0) {
                 throw new Error("Incomplete weather data received from API.");
            }


            hideStatus();
            // Use resolvedAddress if available and more specific than the initial name
            const displayName = data.resolvedAddress || name || 'Selected Location';
            displayCurrentWeather(data, displayName);
            // Ensure days[0].hours exists before passing
            displayHourlyForecast(data.days[0]?.hours || []);
            displayDailyForecast(data.days);
            displayDailyTrendChart(data.days); // Call chart function

            if (saveToHistory) {
                 // Use a more stable ID from resolved address or coords
                 const historyId = data.address || `${lat.toFixed(4)},${lon.toFixed(4)}`;
                 addToHistory({ name: displayName, lat: lat, lon: lon, id: historyId });
            }

        } catch (error) {
            console.error("Fetch Weather Error:", error);
            showError(`Failed to fetch weather: ${error.message}`);
            clearWeatherData(); // Clear display on error
        }
    }

    // --- Data Display ---
    function displayCurrentWeather(data, name) {
        const current = data.currentConditions;
        if (!current) {
             console.warn("Current conditions data missing");
             currentLocationEl.textContent = name; // Show name even if data is partial
             // Clear other fields or show placeholder
             currentIconEl.textContent = '';
             currentTempEl.textContent = '--°C';
             currentRealfeelEl.textContent = 'Feels like: --°C';
             currentConditionsEl.textContent = 'Data unavailable';
             return;
        }

        currentLocationEl.textContent = name;
        currentIconEl.textContent = mapIcon(current.icon);
        currentTempEl.textContent = `${Math.round(current.temp)}°C`;
        currentRealfeelEl.textContent = `Feels like: ${Math.round(current.feelslike)}°C`;
        currentConditionsEl.textContent = current.conditions || 'N/A';
        currentIconEl.setAttribute('aria-label', current.conditions || 'Weather icon');
        currentIconEl.setAttribute('role', 'img');
    }

    function displayHourlyForecast(hourlyData) {
        hourlyContainer.innerHTML = ''; // Clear previous
        if (!hourlyData || hourlyData.length === 0) {
            hourlyContainer.innerHTML = '<div style="padding: 10px; color: #777;">Hourly data not available.</div>';
            return;
        }

        const nowEpoch = Date.now() / 1000;
        // Filter for hours starting from now, limit to 48 entries
        const relevantHours = hourlyData
             .filter(hour => hour.datetimeEpoch >= nowEpoch)
             .slice(0, 48);

        if (relevantHours.length === 0) {
             hourlyContainer.innerHTML = '<div style="padding: 10px; color: #777;">No future hourly data available for today.</div>';
             return;
         }

        relevantHours.forEach(hour => {
            const date = new Date(hour.datetimeEpoch * 1000);
            const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

            const item = document.createElement('div');
            item.className = 'hourly-item';
            item.innerHTML = `
                <div class="hourly-time">${timeString}</div>
                <div class="hourly-icon weather-icon" role="img" aria-label="${hour.conditions || ''}">${mapIcon(hour.icon)}</div>
                <div class="hourly-temp">${Math.round(hour.temp)}°C</div>
                <div class="hourly-realfeel">FL: ${Math.round(hour.feelslike)}°C</div>
                <div class="hourly-precip">💧 ${hour.precipprob !== null ? hour.precipprob : 0}%</div>
                <div class="hourly-precip">${hour.precip !== null ? hour.precip : 0} mm</div>
            `;
            hourlyContainer.appendChild(item);
        });
         hourlyContainer.scrollLeft = 0; // Scroll to start
    }

     function displayDailyForecast(dailyData) {
        dailyContainer.innerHTML = ''; // Clear previous
         if (!dailyData || dailyData.length === 0) {
             dailyContainer.innerHTML = '<div style="padding: 10px; color: #777;">Daily data not available.</div>';
             return;
         }

        // Limit to 15 days if API provides more for some reason
        dailyData.slice(0, 15).forEach(day => {
            const date = new Date(day.datetimeEpoch * 1000);
            const dayString = date.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });

            const item = document.createElement('div');
            item.className = 'daily-item';
            item.innerHTML = `
                <div class="daily-date">${dayString}</div>
                <div class="daily-icon weather-icon" role="img" aria-label="${day.conditions || ''}">${mapIcon(day.icon)}</div>
                <div class="daily-temp">
                    <span class="max" style="color: #ff6384;">${Math.round(day.tempmax)}°</span> / <span class="min" style="color: #36a2eb;">${Math.round(day.tempmin)}°</span>
                </div>
                <div class="daily-precip">💧 ${day.precipprob !== null ? day.precipprob : 0}%</div>
                <div class="daily-precip">${day.precip !== null ? day.precip : 0} mm</div>
            `;
            dailyContainer.appendChild(item);
        });
        dailyContainer.scrollLeft = 0; // Scroll to start
    }

    function displayDailyTrendChart(dailyData) {
        // Ensure context and plugin are available
        if (!dailyTrendChartCtx || typeof ChartDataLabels === 'undefined') {
             if(!dailyTrendChartCtx) console.error("Chart canvas context not found.");
             if(typeof ChartDataLabels === 'undefined') console.warn("ChartDataLabels not loaded, cannot display labels on chart.");
             // Clear any previous chart drawing area
             if (dailyChartInstance) dailyChartInstance.destroy();
             if (dailyTrendChartCtx) dailyTrendChartCtx.clearRect(0, 0, dailyTrendChartCtx.canvas.width, dailyTrendChartCtx.canvas.height);
             return;
        }
         if (!dailyData || dailyData.length === 0) {
             console.warn("No daily data available for chart.");
             if (dailyChartInstance) dailyChartInstance.destroy();
              if (dailyTrendChartCtx) dailyTrendChartCtx.clearRect(0, 0, dailyTrendChartCtx.canvas.width, dailyTrendChartCtx.canvas.height);
             return;
         }


        // Destroy previous chart instance before creating new one
        if (dailyChartInstance) {
            dailyChartInstance.destroy();
            dailyChartInstance = null;
        }

        // Prepare data, limiting to 15 days
        const limitedDailyData = dailyData.slice(0, 15);
        const labels = limitedDailyData.map(day => new Date(day.datetimeEpoch * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }));
        const maxTemps = limitedDailyData.map(day => day.tempmax);
        const minTemps = limitedDailyData.map(day => day.tempmin);

        // Create the new chart
        dailyChartInstance = new Chart(dailyTrendChartCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Max Temp (°C)',
                        data: maxTemps,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        pointRadius: 3, // Smaller points
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Min Temp (°C)',
                        data: minTemps,
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1,
                        pointRadius: 3, // Smaller points
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // Allows control via CSS aspect-ratio/height
                scales: {
                    y: {
                        beginAtZero: false, // Temp scales shouldn't always start at 0
                         ticks: {
                             callback: function(value) { return value + '°C'; },
                             font: { size: 10 } // Smaller axis labels
                         }
                    },
                    x: {
                         ticks: {
                             font: { size: 10 } // Smaller axis labels
                         }
                    }
                },
                 plugins: {
                     // --- DATALABELS CONFIGURATION ---
                     datalabels: {
                         display: true,
                         align: (context) => context.datasetIndex === 0 ? 'top' : 'bottom', // Max top, Min bottom
                         padding: { top: 3, bottom: 3 }, // Reduced padding
                         color: (context) => context.dataset.borderColor, // Match line color
                         font: {
                             size: 9, // Smaller label font size
                             weight: 'bold',
                         },
                         formatter: (value) => {
                             // Avoid displaying label for null/undefined data points
                             if (value === null || typeof value === 'undefined') return '';
                             return Math.round(value) + '°';
                         },
                         // Optional: Prevent labels overlapping points too much
                         // offset: 4,
                         // Optional: Hide labels if they overlap significantly (requires careful tuning)
                         // display: 'auto',
                         // clamp: true // Prevent labels going outside chart area
                     },
                     // --- TOOLTIP & LEGEND ---
                    tooltip: {
                        mode: 'index', // Show both values on hover over x-axis point
                        intersect: false, // Tooltip appears even if not directly hovering point
                         callbacks: {
                             label: function(context) {
                                 let label = context.dataset.label || '';
                                 if (label) label += ': ';
                                 if (context.parsed.y !== null) {
                                     // Format tooltip value precisely
                                     label += context.parsed.y.toFixed(1) + '°C';
                                 } else {
                                     label += 'N/A';
                                 }
                                 return label;
                             }
                         }
                    },
                    legend: {
                        position: 'top',
                        labels: {
                             font: { size: 11 }, // Smaller legend font
                             boxWidth: 20, // Smaller legend color box
                             padding: 10 // Padding around legend items
                        }
                    },
                },
                 // Improve performance potentially
                 animation: {
                     duration: 500 // Shorter animation
                 },
                 hover: {
                     mode: 'index',
                     intersect: false
                 },
            }
            // Global plugin registration is usually preferred now
            // plugins: [ChartDataLabels]
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
        // Clear the canvas area
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
        // Prevent overly technical messages from showing directly to user
        let displayMessage = message;
        if (message.includes('API error') || message.includes('HTTP error') || message.includes('Failed to fetch')) {
             displayMessage = "Could not retrieve weather data. Please check connection or try again later.";
        } else if (message.includes('Invalid location') || message.includes('Could not find location')) {
             displayMessage = message; // Keep location specific errors
        }
        statusMessage.textContent = displayMessage;
        statusMessage.className = 'status-message error';
    }

    function hideStatus() {
        statusMessage.textContent = '';
        statusMessage.style.display = 'none';
        statusMessage.className = 'status-message';
    }

    function mapIcon(iconCode) {
        // Simple emoji mapping
        const iconMap = {
            'snow': '❄️', 'snow-showers-day': '🌨️', 'snow-showers-night': '🌨️',
            'thunder-rain': '⛈️', 'thunder-showers-day': '⛈️', 'thunder-showers-night': '⛈️',
            'rain': '🌧️', 'showers-day': '🌦️', 'showers-night': '🌦️',
            'fog': '🌫️', 'wind': '💨', 'cloudy': '☁️',
            'partly-cloudy-day': '⛅', 'partly-cloudy-night': '☁️🌙',
            'clear-day': '☀️', 'clear-night': '🌙',
        };
        // Fallback for unknown codes
        return iconMap[iconCode] || '🌡️'; // Use a generic temp icon as fallback
    }


    // --- Local Storage / History ---
    function loadHistory() {
        try {
            const storedHistory = localStorage.getItem(HISTORY_KEY);
            searchHistory = storedHistory ? JSON.parse(storedHistory) : [];
             // Basic validation of stored data
             if (!Array.isArray(searchHistory)) {
                 searchHistory = [];
             }
             searchHistory = searchHistory.filter(item => item && item.id && item.name && typeof item.lat === 'number' && typeof item.lon === 'number');

        } catch (e) {
            console.error("Failed to load or parse history from localStorage:", e);
            searchHistory = [];
            localStorage.removeItem(HISTORY_KEY); // Clear corrupted data
        }
    }

    function saveHistory() {
        try {
            // Limit history size before saving
            if (searchHistory.length > MAX_HISTORY_ITEMS) {
                searchHistory = searchHistory.slice(0, MAX_HISTORY_ITEMS);
            }
            localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory));
            updateHistoryDropdown();
        } catch (e) {
            console.error("Failed to save history to localStorage:", e);
            // Potentially inform user if storage is full?
        }
    }

    function addToHistory(locationData) {
        // Ensure locationData has necessary fields
        if (!locationData || !locationData.id || !locationData.name || typeof locationData.lat !== 'number' || typeof locationData.lon !== 'number') {
            console.warn("Attempted to add invalid location data to history:", locationData);
            return;
        }

        // Remove existing entry with the same ID to prevent duplicates and ensure newest is on top
        searchHistory = searchHistory.filter(item => item.id !== locationData.id);

        // Add the new location to the beginning
        searchHistory.unshift(locationData);
        saveHistory(); // Save updated history (handles size limit and dropdown update)
    }

     function moveToTopOfHistory(locationId) {
        const index = searchHistory.findIndex(item => item.id === locationId);
        // Move only if found and not already at the top
        if (index > 0) {
            const [item] = searchHistory.splice(index, 1); // Remove item from its current position
            searchHistory.unshift(item); // Add it to the beginning
            saveHistory(); // Save the reordered history
        }
    }

    function updateHistoryDropdown() {
        historySelect.innerHTML = '<option value="">Select a recent location</option>'; // Add placeholder first
        searchHistory.forEach(location => {
            const option = document.createElement('option');
            option.value = location.id;
            option.textContent = location.name; // Display name in dropdown
            option.title = `Lat: ${location.lat.toFixed(4)}, Lon: ${location.lon.toFixed(4)}`; // Add coords to title attr for info
            historySelect.appendChild(option);
        });
         // Disable dropdown if history is empty
         historySelect.disabled = searchHistory.length === 0;
    }

    // --- Start the App ---
    init();
});
