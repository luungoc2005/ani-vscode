/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { LAppSubdelegate } from './lappsubdelegate';

/**
 * Sprite implementation class
 *
 * Manages texture ID and Rect.
 */
export class LAppSprite {
  /**
   * Constructor
   * @param x            x position
   * @param y            y position
   * @param width        width
   * @param height       height
   * @param textureId    texture
   */
  public constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    textureId: WebGLTexture
  ) {
    this._rect = new Rect();
    this._rect.left = x - width * 0.5;
    this._rect.right = x + width * 0.5;
    this._rect.up = y + height * 0.5;
    this._rect.down = y - height * 0.5;
    this._texture = textureId;
    this._vertexBuffer = null;
    this._uvBuffer = null;
    this._indexBuffer = null;

    this._positionLocation = null;
    this._uvLocation = null;
    this._textureLocation = null;

    this._positionArray = null;
    this._uvArray = null;
    this._indexArray = null;

    this._firstDraw = true;
  }

  /**
   * Release.
   */
  public release(): void {
    this._rect = null;

    const gl = this._subdelegate.getGlManager().getGl();

    gl.deleteTexture(this._texture);
    this._texture = null;

    gl.deleteBuffer(this._uvBuffer);
    this._uvBuffer = null;

    gl.deleteBuffer(this._vertexBuffer);
    this._vertexBuffer = null;

    gl.deleteBuffer(this._indexBuffer);
    this._indexBuffer = null;
  }

  /**
   * Return texture
   */
  public getTexture(): WebGLTexture {
    return this._texture;
  }

  /**
   * Render.
   * @param programId Shader program
   */
  public render(programId: WebGLProgram): void {
    if (this._texture == null) {
      // Not yet loaded
      return;
    }

    const gl = this._subdelegate.getGlManager().getGl();

    // On first draw
    if (this._firstDraw) {
      // Get attribute locations
      this._positionLocation = gl.getAttribLocation(programId, 'position');
      gl.enableVertexAttribArray(this._positionLocation);

      this._uvLocation = gl.getAttribLocation(programId, 'uv');
      gl.enableVertexAttribArray(this._uvLocation);

      // Get uniform location
      this._textureLocation = gl.getUniformLocation(programId, 'texture');

      // Register uniform
      gl.uniform1i(this._textureLocation, 0);

      // Initialize UV buffer
      {
        this._uvArray = new Float32Array([
          1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0
        ]);

        this._uvBuffer = gl.createBuffer();
      }

      // Initialize vertex buffer
      {
        const maxWidth = this._subdelegate.getCanvas().width;
        const maxHeight = this._subdelegate.getCanvas().height;

        // Vertex data
        this._positionArray = new Float32Array([
          (this._rect.right - maxWidth * 0.5) / (maxWidth * 0.5),
          (this._rect.up - maxHeight * 0.5) / (maxHeight * 0.5),
          (this._rect.left - maxWidth * 0.5) / (maxWidth * 0.5),
          (this._rect.up - maxHeight * 0.5) / (maxHeight * 0.5),
          (this._rect.left - maxWidth * 0.5) / (maxWidth * 0.5),
          (this._rect.down - maxHeight * 0.5) / (maxHeight * 0.5),
          (this._rect.right - maxWidth * 0.5) / (maxWidth * 0.5),
          (this._rect.down - maxHeight * 0.5) / (maxHeight * 0.5)
        ]);

        this._vertexBuffer = gl.createBuffer();
      }

      // Initialize index buffer
      {
        // Indices
        this._indexArray = new Uint16Array([0, 1, 2, 3, 2, 0]);

        this._indexBuffer = gl.createBuffer();
      }

      this._firstDraw = false;
    }

    // Set UV buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._uvArray, gl.STATIC_DRAW);

    // Set UV attribute
    gl.vertexAttribPointer(this._uvLocation, 2, gl.FLOAT, false, 0, 0);

    // Set position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._positionArray, gl.STATIC_DRAW);

    // Set position attribute
    gl.vertexAttribPointer(this._positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this._indexArray, gl.DYNAMIC_DRAW);

    // Draw
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.drawElements(
      gl.TRIANGLES,
      this._indexArray.length,
      gl.UNSIGNED_SHORT,
      0
    );
  }

  /**
   * Hit test
   */
  public isHit(pointX: number, pointY: number): boolean {
    // Get canvas height
    const { height } = this._subdelegate.getCanvas();

    // Y needs to be flipped
    const y = height - pointY;

    return (
      pointX >= this._rect.left &&
      pointX <= this._rect.right &&
      y <= this._rect.up &&
      y >= this._rect.down
    );
  }

  /**
   * setter
   */
  public setSubdelegate(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
  }

  _texture: WebGLTexture; // texture
  _vertexBuffer: WebGLBuffer; // vertex buffer
  _uvBuffer: WebGLBuffer; // uv buffer
  _indexBuffer: WebGLBuffer; // index buffer
  _rect: Rect; // rectangle

  _positionLocation: number;
  _uvLocation: number;
  _textureLocation: WebGLUniformLocation;

  _positionArray: Float32Array;
  _uvArray: Float32Array;
  _indexArray: Uint16Array;

  _firstDraw: boolean;

  private _subdelegate: LAppSubdelegate;
}

export class Rect {
  public left: number; // left edge
  public right: number; // right edge
  public up: number; // top edge
  public down: number; // bottom edge
}
