// eslint-disable-next-line no-undef
window.CESIUM_BASE_URL = window.CESIUM_BASE_URL
  ? window.CESIUM_BASE_URL
  : "../../Build/CesiumUnminified/";

import {
  Cartesian3,
  defined,
  formatError,
  Math as CesiumMath,
  objectToQuery,
  queryToObject,
  CzmlDataSource,
  GeoJsonDataSource,
  ImageryLayer,
  KmlDataSource,
  GpxDataSource,
  Terrain,
  TileMapServiceImageryProvider,
  Viewer,
  viewerCesiumInspectorMixin,
  viewerDragDropMixin,
  
  buildModuleUrl,
  Cartesian2,
  Cartographic,
  Check,
  defaultValue,
  deprecationWarning,
  GeographicProjection,
  GeographicTilingScheme,
  Rectangle,
  RequestErrorEvent,
  Resource,
  RuntimeError,
  TileProviderError,
  WebMercatorTilingScheme,
  UrlTemplateImageryProvider
} from "../../Build/CesiumUnminified/index.js";

function TestServiceImageryProvider(options) {
  options = defaultValue(options, defaultValue.EMPTY_OBJECT);

  if (defined(options.url)) {
    deprecationWarning(
      "TileMapServiceImageryProvider options.url",
      "options.url was deprecated in CesiumJS 1.104.  It will be removed in CesiumJS 1.107.  Use TileMapServiceImageryProvider.fromUrl instead."
    );

    this._metadataError = undefined;
    this._ready = false;

    let resource;
    const that = this;
    const promise = Promise.resolve(options.url)
      .then(function (url) {
        resource = Resource.createIfNeeded(url);
        resource.appendForwardSlash();

        that._tmsResource = resource;
        that._xmlResource = resource.getDerivedResource({
          url: "tilemapresource.xml",
        });

        return TestServiceImageryProvider._requestMetadata(
          options,
          that._tmsResource,
          that._xmlResource,
          that
        );
      })
      .catch((e) => {
        return Promise.reject(e);
      });

    UrlTemplateImageryProvider.call(this, promise);
    this._promise = promise;
  }

  // After readyPromise deprecation, this should become just
  // UrlTemplateImageryProvider.call(this, options);
}



TestServiceImageryProvider._requestMetadata = async function (
  options,
  tmsResource,
  xmlResource,
  provider
) {
  // Try to load remaining parameters from XML
  try {
    const xml = await xmlResource.fetchXML();
    return TestServiceImageryProvider._metadataSuccess(
      xml,
      options,
      tmsResource,
      xmlResource,
      provider
    );
  } catch (e) {
    if (e instanceof RequestErrorEvent) {
      return TestServiceImageryProvider._metadataFailure(
        options,
        tmsResource
      );
    }

    throw e;
  }
};

TestServiceImageryProvider.fromUrl = async function (url, options) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("url", url);
  //>>includeEnd('debug');

  const resource = Resource.createIfNeeded(url);
  resource.appendForwardSlash();

  console.log(resource)
  const tmsResource = resource;
  const xmlResource = resource.getDerivedResource({
    url: "tilemapresource.xml",
  });

  options = defaultValue(options, defaultValue.EMPTY_OBJECT);
  const metadata = await TestServiceImageryProvider._requestMetadata(
    options,
    tmsResource,
    xmlResource
  );
  console.log(metadata)

  const provider = new TestServiceImageryProvider();
  console.log(provider)
  UrlTemplateImageryProvider.call(provider, metadata);
  provider.__proto__ = UrlTemplateImageryProvider.prototype;
  console.log(provider)
  return provider;
};

function confineRectangleToTilingScheme(rectangle, tilingScheme) {
  if (rectangle.west < tilingScheme.rectangle.west) {
    rectangle.west = tilingScheme.rectangle.west;
  }
  if (rectangle.east > tilingScheme.rectangle.east) {
    rectangle.east = tilingScheme.rectangle.east;
  }
  if (rectangle.south < tilingScheme.rectangle.south) {
    rectangle.south = tilingScheme.rectangle.south;
  }
  if (rectangle.north > tilingScheme.rectangle.north) {
    rectangle.north = tilingScheme.rectangle.north;
  }
  return rectangle;
}

function calculateSafeMinimumDetailLevel(
  tilingScheme,
  rectangle,
  minimumLevel
) {
  // Check the number of tiles at the minimum level.  If it's more than four,
  // try requesting the lower levels anyway, because starting at the higher minimum
  // level will cause too many tiles to be downloaded and rendered.
  const swTile = tilingScheme.positionToTileXY(
    Rectangle.southwest(rectangle),
    minimumLevel
  );
  const neTile = tilingScheme.positionToTileXY(
    Rectangle.northeast(rectangle),
    minimumLevel
  );
  const tileCount =
    (Math.abs(neTile.x - swTile.x) + 1) * (Math.abs(neTile.y - swTile.y) + 1);
  if (tileCount > 4) {
    return 0;
  }
  return minimumLevel;
}

TestServiceImageryProvider._metadataSuccess = function (
  xml,
  options,
  tmsResource,
  xmlResource,
  provider
) {
  const tileFormatRegex = /tileformat/i;
  const tileSetRegex = /tileset/i;
  const tileSetsRegex = /tilesets/i;
  const bboxRegex = /boundingbox/i;
  let format, bbox, tilesets;
  const tilesetsList = []; //list of TileSets

  // Allowing options properties (already copied to that) to override XML values

  // Iterate XML Document nodes for properties
  const nodeList = xml.childNodes[0].childNodes;
  for (let i = 0; i < nodeList.length; i++) {
    if (tileFormatRegex.test(nodeList.item(i).nodeName)) {
      format = nodeList.item(i);
    } else if (tileSetsRegex.test(nodeList.item(i).nodeName)) {
      tilesets = nodeList.item(i); // Node list of TileSets
      const tileSetNodes = nodeList.item(i).childNodes;
      // Iterate the nodes to find all TileSets
      for (let j = 0; j < tileSetNodes.length; j++) {
        if (tileSetRegex.test(tileSetNodes.item(j).nodeName)) {
          // Add them to tilesets list
          tilesetsList.push(tileSetNodes.item(j));
        }
      }
    } else if (bboxRegex.test(nodeList.item(i).nodeName)) {
      bbox = nodeList.item(i);
    }
  }
  console.log(format, tilesetsList)

  let message;
  if (!defined(tilesets) || !defined(bbox)) {
    message = `Unable to find expected tilesets or bbox attributes in ${xmlResource.url}.`;
    if (defined(provider)) {
      TileProviderError.reportError(
        undefined,
        provider,
        provider.errorEvent,
        message
      );
    }

    throw new RuntimeError(message);
  }

  const fileExtension = defaultValue(
    options.fileExtension,
    format.getAttribute("extension")
  );
  const tileWidth = defaultValue(
    options.tileWidth,
    parseInt(format.getAttribute("width"), 10)
  );
  const tileHeight = defaultValue(
    options.tileHeight,
    parseInt(format.getAttribute("height"), 10)
  );
  let minimumLevel = defaultValue(
    options.minimumLevel,
    parseInt(tilesetsList[0].getAttribute("order"), 10)
  );
  const maximumLevel = defaultValue(
    options.maximumLevel,
    parseInt(tilesetsList[tilesetsList.length - 1].getAttribute("order"), 10)
  );
  const tilingSchemeName = tilesets.getAttribute("profile");
  let tilingScheme = options.tilingScheme;

  if (!defined(tilingScheme)) {
    if (
      tilingSchemeName === "geodetic" ||
      tilingSchemeName === "global-geodetic"
    ) {
      tilingScheme = new GeographicTilingScheme({
        ellipsoid: options.ellipsoid,
      });
    } else if (
      tilingSchemeName === "mercator" ||
      tilingSchemeName === "global-mercator"
    ) {
      tilingScheme = new WebMercatorTilingScheme({
        ellipsoid: options.ellipsoid,
      });
    } else {
      message = `${xmlResource.url} specifies an unsupported profile attribute, ${tilingSchemeName}.`;
      if (defined(provider)) {
        TileProviderError.reportError(
          undefined,
          provider,
          provider.errorEvent,
          message
        );
      }

      throw new RuntimeError(message);
    }
  }

  // rectangle handling
  let rectangle = Rectangle.clone(options.rectangle);

  if (!defined(rectangle)) {
    let sw;
    let ne;
    let swXY;
    let neXY;

    // In older versions of gdal x and y values were flipped, which is why we check for an option to flip
    // the values here as well. Unfortunately there is no way to autodetect whether flipping is needed.
    const flipXY = defaultValue(options.flipXY, false);
    if (flipXY) {
      swXY = new Cartesian2(
        parseFloat(bbox.getAttribute("miny")),
        parseFloat(bbox.getAttribute("minx"))
      );
      neXY = new Cartesian2(
        parseFloat(bbox.getAttribute("maxy")),
        parseFloat(bbox.getAttribute("maxx"))
      );
    } else {
      swXY = new Cartesian2(
        parseFloat(bbox.getAttribute("minx")),
        parseFloat(bbox.getAttribute("miny"))
      );
      neXY = new Cartesian2(
        parseFloat(bbox.getAttribute("maxx")),
        parseFloat(bbox.getAttribute("maxy"))
      );
    }

    // Determine based on the profile attribute if this tileset was generated by gdal2tiles.py, which
    // uses 'mercator' and 'geodetic' profiles, or by a tool compliant with the TMS standard, which is
    // 'global-mercator' and 'global-geodetic' profiles. In the gdal2Tiles case, X and Y are always in
    // geodetic degrees.
    const isGdal2tiles =
      tilingSchemeName === "geodetic" || tilingSchemeName === "mercator";
    if (
      tilingScheme.projection instanceof GeographicProjection ||
      isGdal2tiles
    ) {
      console.log(tilingScheme.projection)
      sw = Cartographic.fromDegrees(swXY.x, swXY.y);
      ne = Cartographic.fromDegrees(neXY.x, neXY.y);
    } else {
      const projection = tilingScheme.projection;
      sw = projection.unproject(swXY);
      ne = projection.unproject(neXY);
    }

    rectangle = new Rectangle(
      sw.longitude,
      sw.latitude,
      ne.longitude,
      ne.latitude
    );
  }

  // The rectangle must not be outside the bounds allowed by the tiling scheme.
  rectangle = confineRectangleToTilingScheme(rectangle, tilingScheme);
  // clamp our minimum detail level to something that isn't going to request a ridiculous number of tiles
  minimumLevel = calculateSafeMinimumDetailLevel(
    tilingScheme,
    rectangle,
    minimumLevel
  );

  const templateResource = tmsResource.getDerivedResource({
    url: `{z}/{x}/{reverseY}.${fileExtension}`,
  });

  return {
    url: templateResource,
    tilingScheme: tilingScheme,
    rectangle: rectangle,
    tileWidth: tileWidth,
    tileHeight: tileHeight,
    minimumLevel: minimumLevel,
    maximumLevel: maximumLevel,
    tileDiscardPolicy: options.tileDiscardPolicy,
    credit: options.credit,
  };
};

TestServiceImageryProvider._metadataFailure = function (
  options,
  tmsResource
) {
  // Can't load XML, still allow options and defaults
  const fileExtension = defaultValue(options.fileExtension, "png");
  const tileWidth = defaultValue(options.tileWidth, 256);
  const tileHeight = defaultValue(options.tileHeight, 256);
  const maximumLevel = options.maximumLevel;
  const tilingScheme = defined(options.tilingScheme)
    ? options.tilingScheme
    : new WebMercatorTilingScheme({ ellipsoid: options.ellipsoid });

  let rectangle = defaultValue(options.rectangle, tilingScheme.rectangle);
  // The rectangle must not be outside the bounds allowed by the tiling scheme.
  rectangle = confineRectangleToTilingScheme(rectangle, tilingScheme);

  // make sure we use a safe minimum detail level, so we don't request a ridiculous number of tiles
  const minimumLevel = calculateSafeMinimumDetailLevel(
    tilingScheme,
    rectangle,
    options.minimumLevel
  );

  const templateResource = tmsResource.getDerivedResource({
    url: `{z}/{x}/{reverseY}.${fileExtension}`,
  });

  return {
    url: templateResource,
    tilingScheme: tilingScheme,
    rectangle: rectangle,
    tileWidth: tileWidth,
    tileHeight: tileHeight,
    minimumLevel: minimumLevel,
    maximumLevel: maximumLevel,
    tileDiscardPolicy: options.tileDiscardPolicy,
    credit: options.credit,
  };
};


async function main() {
  /*
     Options parsed from query string:
       source=url          The URL of a CZML/GeoJSON/KML data source to load at startup.
                           Automatic data type detection uses file extension.
       sourceType=czml/geojson/kml
                           Override data type detection for source.
       flyTo=false         Don't automatically fly to the loaded source.
       tmsImageryUrl=url   Automatically use a TMS imagery provider.
       lookAt=id           The ID of the entity to track at startup.
       stats=true          Enable the FPS performance display.
       inspector=true      Enable the inspector widget.
       debug=true          Full WebGL error reporting at substantial performance cost.
       theme=lighter       Use the dark-text-on-light-background theme.
       scene3DOnly=true    Enable 3D only mode.
       view=longitude,latitude,[height,heading,pitch,roll]
                           Automatically set a camera view. Values in degrees and meters.
                           [height,heading,pitch,roll] default is looking straight down, [300,0,-90,0]
       saveCamera=false    Don't automatically update the camera view in the URL when it changes.
     */
  const endUserOptions = queryToObject(window.location.search.substring(1));

  let baseLayer;
  if (defined(endUserOptions.tmsImageryUrl)) {
    baseLayer = ImageryLayer.fromProviderAsync(
      TestServiceImageryProvider.fromUrl(endUserOptions.tmsImageryUrl)
    );
  }

  const loadingIndicator = document.getElementById("loadingIndicator");
  // const hasBaseLayerPicker = !defined(baseLayer);

  // const terrain = Terrain.fromWorldTerrain({
  //   requestWaterMask: true,
  //   requestVertexNormals: true,
  // });

  let viewer;
  try {
    // viewer = new Viewer("cesiumContainer", {
    //   baseLayer: baseLayer,
    //   baseLayerPicker: hasBaseLayerPicker,
    //   scene3DOnly: endUserOptions.scene3DOnly,
    //   requestRenderMode: true,
    //   terrain: terrain,
    // });

    // if (hasBaseLayerPicker) {
    //   const viewModel = viewer.baseLayerPicker.viewModel;
    //   viewModel.selectedTerrain = viewModel.terrainProviderViewModels[1];
    // }
    viewer = new Viewer("cesiumContainer", {
      baseLayer: ImageryLayer.fromProviderAsync(
        TestServiceImageryProvider.fromUrl(
          "../../packages/engine/Source/Assets/Textures/NaturalEarthII"
        )
      ),
      baseLayerPicker: false,
      geocoder: false,
    });
  } catch (exception) {
    loadingIndicator.style.display = "none";
    const message = formatError(exception);
    console.error(message);
    if (!document.querySelector(".cesium-widget-errorPanel")) {
      //eslint-disable-next-line no-alert
      window.alert(message);
    }
    return;
  }

  viewer.extend(viewerDragDropMixin);
  if (endUserOptions.inspector) {
    viewer.extend(viewerCesiumInspectorMixin);
  }

  const showLoadError = function (name, error) {
    const title = `An error occurred while loading the file: ${name}`;
    const message =
      "An error occurred while loading the file, which may indicate that it is invalid.  A detailed error report is below:";
    viewer.cesiumWidget.showErrorPanel(title, message, error);
  };

  viewer.dropError.addEventListener(function (viewerArg, name, error) {
    showLoadError(name, error);
  });

  const scene = viewer.scene;
  const context = scene.context;
  if (endUserOptions.debug) {
    context.validateShaderProgram = true;
    context.validateFramebuffer = true;
    context.logShaderCompilation = true;
    context.throwOnWebGLError = true;
  }

  const view = endUserOptions.view;
  const source = endUserOptions.source;
  if (defined(source)) {
    let sourceType = endUserOptions.sourceType;
    if (!defined(sourceType)) {
      // autodetect using file extension if not specified
      if (/\.czml$/i.test(source)) {
        sourceType = "czml";
      } else if (
        /\.geojson$/i.test(source) ||
        /\.json$/i.test(source) ||
        /\.topojson$/i.test(source)
      ) {
        sourceType = "geojson";
      } else if (/\.kml$/i.test(source) || /\.kmz$/i.test(source)) {
        sourceType = "kml";
      } else if (/\.gpx$/i.test(source) || /\.gpx$/i.test(source)) {
        sourceType = "gpx";
      }
    }

    let loadPromise;
    if (sourceType === "czml") {
      loadPromise = CzmlDataSource.load(source);
    } else if (sourceType === "geojson") {
      loadPromise = GeoJsonDataSource.load(source);
    } else if (sourceType === "kml") {
      loadPromise = KmlDataSource.load(source, {
        camera: scene.camera,
        canvas: scene.canvas,
        screenOverlayContainer: viewer.container,
      });
    } else if (sourceType === "gpx") {
      loadPromise = GpxDataSource.load(source);
    } else {
      showLoadError(source, "Unknown format.");
    }

    if (defined(loadPromise)) {
      try {
        const dataSource = await viewer.dataSources.add(loadPromise);
        const lookAt = endUserOptions.lookAt;
        if (defined(lookAt)) {
          const entity = dataSource.entities.getById(lookAt);
          if (defined(entity)) {
            viewer.trackedEntity = entity;
          } else {
            const error = `No entity with id "${lookAt}" exists in the provided data source.`;
            showLoadError(source, error);
          }
        } else if (!defined(view) && endUserOptions.flyTo !== "false") {
          viewer.flyTo(dataSource);
        }
      } catch (error) {
        showLoadError(source, error);
      }
    }
  }

  if (endUserOptions.stats) {
    scene.debugShowFramesPerSecond = true;
  }

  const theme = endUserOptions.theme;
  if (defined(theme)) {
    if (endUserOptions.theme === "lighter") {
      document.body.classList.add("cesium-lighter");
      viewer.animation.applyThemeChanges();
    } else {
      const error = `Unknown theme: ${theme}`;
      viewer.cesiumWidget.showErrorPanel(error, "");
    }
  }

  if (defined(view)) {
    const splitQuery = view.split(/[ ,]+/);
    if (splitQuery.length > 1) {
      const longitude = !isNaN(+splitQuery[0]) ? +splitQuery[0] : 0.0;
      const latitude = !isNaN(+splitQuery[1]) ? +splitQuery[1] : 0.0;
      const height =
        splitQuery.length > 2 && !isNaN(+splitQuery[2])
          ? +splitQuery[2]
          : 300.0;
      const heading =
        splitQuery.length > 3 && !isNaN(+splitQuery[3])
          ? CesiumMath.toRadians(+splitQuery[3])
          : undefined;
      const pitch =
        splitQuery.length > 4 && !isNaN(+splitQuery[4])
          ? CesiumMath.toRadians(+splitQuery[4])
          : undefined;
      const roll =
        splitQuery.length > 5 && !isNaN(+splitQuery[5])
          ? CesiumMath.toRadians(+splitQuery[5])
          : undefined;

      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, latitude, height),
        orientation: {
          heading: heading,
          pitch: pitch,
          roll: roll,
        },
      });
    }
  }

  const camera = viewer.camera;
  function saveCamera() {
    const position = camera.positionCartographic;
    let hpr = "";
    if (defined(camera.heading)) {
      hpr = `,${CesiumMath.toDegrees(camera.heading)},${CesiumMath.toDegrees(
        camera.pitch
      )},${CesiumMath.toDegrees(camera.roll)}`;
    }
    endUserOptions.view = `${CesiumMath.toDegrees(
      position.longitude
    )},${CesiumMath.toDegrees(position.latitude)},${position.height}${hpr}`;
    history.replaceState(undefined, "", `?${objectToQuery(endUserOptions)}`);
  }

  let timeout;
  if (endUserOptions.saveCamera !== "false") {
    camera.changed.addEventListener(function () {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(saveCamera, 1000);
    });
  }

  loadingIndicator.style.display = "none";
}

main();
