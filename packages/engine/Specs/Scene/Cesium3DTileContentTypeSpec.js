import { Cesium3DTileContentType } from "../../index.js";

describe("Scene/Cesium3DTileContentType", function () {
  it("isBinaryFormat correctly identifies binary contents", function () {
    const types = [
      "b3dm",
      "i3dm",
      "glb",
      "vctr",
      "geom",
      "subt",
      "cmpt",
      "pnts",
    ];
    types.map(function (type) {
      expect(Cesium3DTileContentType.isBinaryFormat(type)).toBe(true);
    });
  });

  it("isBinaryFormat returns false for other content types", function () {
    const types = [
      "gltf",
      "subtreeJson",
      "externalTileset",
      "multipleContent",
      "geoJson",
      "notAMagic",
    ];
    types.map(function (type) {
      expect(Cesium3DTileContentType.isBinaryFormat(type)).toBe(false);
    });
  });
});
