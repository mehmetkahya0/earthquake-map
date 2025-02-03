let map;
let markers = [];
let heatmapLayer;
let currentView = 'markers';
let currentTimeFrame = '1';

// Initialize map
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        maxZoom: 18,
        minZoom: 2
    }).setView([30, 0], 2);
    
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Initialize empty heatmap layer
    heatmapLayer = L.heatLayer([], {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        max: 1.0,
        gradient: {
            0.1: '#28a745',
            0.3: '#ffc107',
            0.6: '#fd7e14',
            1.0: '#dc3545'
        }
    }).addTo(map);
    heatmapLayer.setLatLngs([]);
}

async function fetchEarthquakes(timeFrame) {
    const endpoints = {
        '1': 'all_day',
        '7': 'all_week',
        '30': 'all_month'
    };

    try {
        const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${endpoints[timeFrame]}.geojson`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (!data.features) throw new Error('Invalid data format');
        return data.features;
    } catch (error) {
        console.error('Error fetching earthquake data:', error);
        return [];
    }
}

function clearMap() {
    markers.forEach(marker => marker.remove());
    markers = [];
}

function getMagnitudeColor(magnitude) {
    if (magnitude >= 6) return { color: '#dc3545', class: 'high' };
    if (magnitude >= 4) return { color: '#ffc107', class: 'medium' };
    return { color: '#28a745', class: 'low' };
}

function createLoadingMessage() {
    return `
        <div class="loading-message">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Loading earthquake data...</p>
        </div>
    `;
}

function createMarker(earthquake) {
    const { coordinates } = earthquake.geometry;
    const { mag } = earthquake.properties;
    const { color } = getMagnitudeColor(mag);

    // Changed to circleMarker for better stability
    const marker = L.circleMarker([coordinates[1], coordinates[0]], {
        radius: Math.min(mag * 5, 25), // Limit maximum size
        color: color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1,
        stroke: true
    });

    marker.bindPopup(createPopupContent(earthquake));
    return marker;
}

function updateMapView(earthquakes) {
    if (earthquakes.length === 0) return;

    // Calculate bounds of all earthquakes
    const bounds = L.latLngBounds(earthquakes.map(eq => [
        eq.geometry.coordinates[1],
        eq.geometry.coordinates[0]
    ]));

    // Fit map to bounds with padding
    map.fitBounds(bounds, { padding: [50, 50] });
}

function updateHeatmapData(earthquakes) {
    const maxMagnitude = Math.max(...earthquakes.map(eq => eq.properties.mag));
    const heatmapData = earthquakes.map(eq => {
        const intensity = eq.properties.mag / maxMagnitude;
        return [
            eq.geometry.coordinates[1],
            eq.geometry.coordinates[0],
            intensity
        ];
    });
    
    heatmapLayer.setLatLngs(heatmapData);
}

function toggleView(viewType) {
    currentView = viewType;
    
    // Clear existing layers
    clearMap();
    heatmapLayer.setLatLngs([]);
    
    // Get current earthquakes
    const listContainer = document.getElementById('list-view');
    const earthquakeElements = listContainer.getElementsByClassName('earthquake-item');
    const earthquakes = Array.from(earthquakeElements).map((el, index) => ({
        geometry: {
            coordinates: [
                markers[index].getLatLng().lng,
                markers[index].getLatLng().lat
            ]
        },
        properties: {
            mag: parseFloat(el.querySelector('.magnitude').textContent)
        }
    }));

    if (viewType === 'heatmap') {
        updateHeatmapData(earthquakes);
    } else {
        earthquakes.forEach((eq, index) => {
            markers[index].addTo(map);
        });
    }
}

async function updateEarthquakes(timeFrame) {
    try {
        document.body.style.cursor = 'wait';
        currentTimeFrame = timeFrame;
        
        const earthquakes = await fetchEarthquakes(timeFrame);
        clearMap();
        
        const listContainer = document.getElementById('list-view');
        listContainer.innerHTML = createLoadingMessage();

        // Create marker layer group and clear old markers
        if (map) {
            clearMap();
            const markerGroup = L.layerGroup().addTo(map);
            
            earthquakes.forEach(eq => {
                const marker = createMarker(eq);
                if (currentView === 'markers') {
                    marker.addTo(map);
                }
                markers.push(marker);
            });

            // Update heatmap
            updateHeatmapData(earthquakes);
            
            if (currentView === 'heatmap') {
                markers.forEach(marker => marker.remove());
            } else {
                heatmapLayer.setLatLngs([]);
            }

            // Update list view
            listContainer.innerHTML = earthquakes.length > 0 
                ? earthquakes.map(eq => createListItem(eq)).join('')
                : '<div class="no-data">No earthquakes found for this time period</div>';

            // Update map view
            if (earthquakes.length > 0) {
                updateMapView(earthquakes);
            }

            // Update list header with correct time period
            const period = {
                '1': '24 Hours',
                '7': '7 Days',
                '30': '30 Days'
            }[timeFrame] || '24 Hours';

            document.querySelector('.panel-header h2').textContent = 
                `${earthquakes.length} Earthquakes in the Last ${period}`;
        }

        await updateNews();
    } catch (error) {
        console.error('Error updating earthquakes:', error);
        const listContainer = document.getElementById('list-view');
        listContainer.innerHTML = '<div class="error-message">Error loading earthquake data. Please try again.</div>';
    } finally {
        document.body.style.cursor = 'default';
    }
}

// Add click handler for earthquake list items
document.addEventListener('click', (e) => {
    const earthquakeItem = e.target.closest('.earthquake-item');
    if (earthquakeItem) {
        const index = Array.from(earthquakeItem.parentNode.children).indexOf(earthquakeItem);
        const marker = markers[index];
        if (marker) {
            map.setView(marker.getLatLng(), 8);
            marker.openPopup();
        }
    }
});

// Initialize with auto-refresh
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    updateEarthquakes('1');
    
    // Auto refresh every 5 minutes
    let refreshInterval;
    
    function startAutoRefresh() {
        clearInterval(refreshInterval);
        refreshInterval = setInterval(() => updateEarthquakes(currentTimeFrame), 300000);
    }
    
    // Restart refresh timer when user interacts
    document.querySelectorAll('.filter-btn, .view-btn, .tab-btn').forEach(btn => {
        btn.addEventListener('click', startAutoRefresh);
    });
    
    startAutoRefresh();
    
    // Handle filter buttons with error handling
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            try {
                const timeFrame = e.target.dataset.days;
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                await updateEarthquakes(timeFrame);
            } catch (error) {
                console.error('Error handling button click:', error);
                alert('Failed to update earthquake data. Please try again.');
            }
        });
    });

    // Handle view toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            try {
                const viewType = e.target.dataset.view;
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                toggleView(viewType);
            } catch (error) {
                console.error('Error changing view:', error);
            }
        });
    });
});

function createPopupContent(earthquake) {
    const { properties } = earthquake;
    return `
        <div class="popup-content">
            <h3>Magnitude ${properties.mag.toFixed(1)}</h3>
            <p>${properties.place}</p>
            <p>Time: ${new Date(properties.time).toLocaleString()}</p>
            <a href="${properties.url}" target="_blank">More info</a>
        </div>
    `;
}

function createListItem(earthquake) {
    const { properties } = earthquake;
    const magnitudeClass = getMagnitudeColor(properties.mag).class;
    return `
        <div class="earthquake-item">
            <span class="magnitude magnitude-${magnitudeClass}">${properties.mag.toFixed(1)}</span>
            <div class="earthquake-info">
                <div class="earthquake-place">${properties.place}</div>
                <div class="earthquake-time">${new Date(properties.time).toLocaleString()}</div>
            </div>
        </div>
    `;
}

function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const listView = document.getElementById('list-view');
    const newsView = document.getElementById('news-view');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (btn.dataset.tab === 'list') {
                listView.style.display = 'block';
                newsView.style.display = 'none';
            } else {
                listView.style.display = 'none';
                newsView.style.display = 'block';
            }
        });
    });
}

async function updateNews() {
    const newsContainer = document.getElementById('news-view');
    try {
        const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson');
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            newsContainer.innerHTML = `
                <div class="news-header">
                    <h3>Significant Earthquakes This Month</h3>
                </div>
                ${data.features.map(eq => `
                    <div class="news-item">
                        <h3>Magnitude ${eq.properties.mag.toFixed(1)} Earthquake</h3>
                        <p>${eq.properties.place}</p>
                        <div class="news-footer">
                            <small>${new Date(eq.properties.time).toLocaleString()}</small>
                            <a href="${eq.properties.url}" target="_blank" class="read-more">Details</a>
                        </div>
                    </div>
                `).join('')}
            `;
        } else {
            newsContainer.innerHTML = '<p class="no-news">No significant earthquakes reported this month.</p>';
        }
    } catch (error) {
        console.error('Error fetching news:', error);
        newsContainer.innerHTML = '<p class="error-message">Unable to load earthquake news.</p>';
    }
}

// Add these new CSS animations to your styles.css
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.2); }
        100% { opacity: 0.6; transform: scale(1); }
    }
`;
document.head.appendChild(style);

// Add resize handler
window.addEventListener('resize', () => {
    if (map) {
        map.invalidateSize();
        const earthquakes = markers.map(marker => ({
            geometry: {
                coordinates: [marker.getLatLng().lng, marker.getLatLng().lat]
            }
        }));
        if (earthquakes.length > 0) {
            updateMapView(earthquakes);
        }
    }
});
