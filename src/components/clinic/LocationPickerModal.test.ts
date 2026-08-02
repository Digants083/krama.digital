import { describe, expect, it } from "vitest";
import { buildIndiaAddressQuery, INDIA_MAP_CENTER, parseMapCoordinates } from "./LocationPickerModal";

describe("clinic location defaults", () => {
  it("does not convert missing coordinates into the 0,0 location", () => {
    expect(parseMapCoordinates(null, null)).toBeNull();
    expect(parseMapCoordinates("", "")).toBeNull();
  });

  it("uses India as the default map center and preserves valid saved coordinates", () => {
    expect(INDIA_MAP_CENTER).toEqual({ lat: 20.5937, lng: 78.9629 });
    expect(parseMapCoordinates("12.9716", "77.5946")).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it("keeps automatic address lookup inside India without duplicating the country", () => {
    expect(buildIndiaAddressQuery("MG Road, Bengaluru 560001")).toBe("MG Road, Bengaluru 560001, India");
    expect(buildIndiaAddressQuery("Pune, Maharashtra, India")).toBe("Pune, Maharashtra, India");
    expect(buildIndiaAddressQuery("   ")).toBe("");
  });
});
