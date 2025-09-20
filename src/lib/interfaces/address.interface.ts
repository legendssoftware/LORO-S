export interface Address {
  streetNumber: string;
  street: string;
  suburb: string;
  city: string;
  province: string;
  state: string;
  country: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  placeId?: string; // Google Maps Place ID
}

export interface GeocodingResult {
  address: Address;
  placeId: string;
  formattedAddress: string;
  geometry?: {
    location: { lat: number; lng: number };
    locationType?: string;
    viewport?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
    bounds?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  };
  types?: string[];
} 