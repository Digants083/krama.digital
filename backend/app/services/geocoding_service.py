"""
Geocoding service to convert addresses to precise latitude/longitude coordinates.
Uses Google Maps Geocoding API for high precision and reliability.
"""
import requests
import logging
import os
from typing import Optional, Tuple
from dotenv import load_dotenv

# Ensure .env file is loaded
load_dotenv()

logger = logging.getLogger(__name__)

GOOGLE_MAPS_URL = "https://maps.googleapis.com/maps/api/geocode/json"

def get_coordinates_from_address(
    address: str,
    city: Optional[str] = None,
    pincode: Optional[str] = None
) -> Tuple[Optional[str], Optional[str]]:
    """
    Convert address to precise latitude and longitude using Google Maps Geocoding API.
    """
    try:
        api_key = os.getenv("GOOGLE_MAPS_API_KEY")
        if not api_key:
            logger.error("CRITICAL: GOOGLE_MAPS_API_KEY not found in environment variables. Check your .env file.")
            return None, None

        # Build structured query for better precision
        query_parts = [address]
        if city:
            query_parts.append(city)
        if pincode:
            query_parts.append(pincode)
        query_parts.append("India")

        full_query = ", ".join(filter(None, query_parts))

        params = {
            "address": full_query,
            "key": api_key
        }

        logger.info(f"Requesting coordinates from Google for: {full_query}")

        response = requests.get(
            GOOGLE_MAPS_URL,
            params=params,
            timeout=15
        )

        if response.status_code == 200:
            data = response.json()
            status = data.get("status")

            if status == "OK":
                result = data["results"][0]
                location = result["geometry"]["location"]
                lat = str(location["lat"])
                lon = str(location["lng"])

                logger.info(f"Google Geocoding SUCCESS - Lat: {lat}, Lon: {lon}")
                return lat, lon
            elif status == "ZERO_RESULTS":
                logger.warning(f"Google Geocoding: No results found for address: {full_query}")
            elif status == "OVER_QUERY_LIMIT":
                logger.error("Google Geocoding: API quota exceeded (OVER_QUERY_LIMIT)")
            elif status == "REQUEST_DENIED":
                error_msg = data.get("error_message", "No error message provided")
                logger.error(f"Google Geocoding: Request Denied. Check API key and permissions. Message: {error_msg}")
            else:
                logger.error(f"Google Geocoding API returned unexpected status: {status}")

            return None, None
        else:
            logger.error(f"Google Geocoding API HTTP Error: {response.status_code}")
            return None, None

    except Exception as e:
        logger.error(f"Exception during Google geocoding: {str(e)}")
        return None, None


def get_coordinates_from_structured_address(
    street: str,
    road: str,
    layout: Optional[str],
    section: Optional[str],
    city: str,
    pincode: str
) -> Tuple[Optional[str], Optional[str]]:
    """
    Get precise coordinates from structured address components.
    """
    parts = [street, road]
    if layout:
        parts.append(layout)
    if section:
        parts.append(section)
    parts.extend([city, pincode])

    full_address = ", ".join(filter(None, parts))
    return get_coordinates_from_address(full_address, city, pincode)


def format_coordinates(lat: Optional[str], lon: Optional[str]) -> str:
    """Format coordinates for display"""
    if lat and lon:
        return f"{lat}, {lon}"
    return "Not available"
