import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@borrowbox/auth';
import { CatalogRpc } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { CatalogClient } from '../catalog/catalog.client';
import { AccessToken, CorrelationId } from '../http/request-context';
import {
  CreateItemBody,
  CreatePhotoUploadBody,
  OwnItemResponse,
  PhotoUploadResponse,
  PhotoViewResponse,
  ReorderPhotosBody,
  SetItemLocationBody,
  UpdateItemBody,
} from './items.api';

const itemId = () => Param('itemId', ParseUUIDPipe);
const photoId = () => Param('photoId', ParseUUIDPipe);

/**
 * The signed-in lender's own items and photos (G1). The gateway checks the
 * JWT; Catalog checks it again and checks ownership (someone else's item is
 * always NOT_FOUND).
 */
@ApiTags('my items')
@ApiBearerAuth()
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED',
})
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@ApiResponse({ status: 404, type: ApiErrorResponse, description: 'NOT_FOUND' })
@UseGuards(JwtAuthGuard)
@Controller('me/items')
export class MyItemsController {
  constructor(private readonly catalog: CatalogClient) {}

  @Get()
  @ApiOperation({ summary: 'My items (not deleted), newest first' })
  @ApiOkResponse({ type: [OwnItemResponse] })
  list(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse[]> {
    return this.catalog.call(
      CatalogRpc.listMine,
      {},
      { accessToken, correlationId },
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create an item (a draft)',
    description:
      'The client picks the id; repeating the same create returns the same item. At most 10 items at once, drafts included.',
  })
  @ApiCreatedResponse({ type: OwnItemResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'ITEM_LIMIT_REACHED',
  })
  create(
    @Body() body: CreateItemBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(CatalogRpc.create, body, {
      accessToken,
      correlationId,
    });
  }

  @Get(':itemId')
  @ApiOperation({ summary: 'One of my items, exact location included' })
  @ApiOkResponse({ type: OwnItemResponse })
  get(
    @itemId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.getOwn,
      { itemId: id },
      { accessToken, correlationId },
    );
  }

  @Patch(':itemId')
  @ApiOperation({ summary: 'Change the fields sent' })
  @ApiOkResponse({ type: OwnItemResponse })
  update(
    @itemId() id: string,
    @Body() body: UpdateItemBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.update,
      { ...body, itemId: id },
      { accessToken, correlationId },
    );
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an item and its photos (repeating is fine)',
  })
  @ApiNoContentResponse()
  async delete(
    @itemId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.catalog.call(
      CatalogRpc.delete,
      { itemId: id },
      { accessToken, correlationId },
    );
  }

  @Put(':itemId/location')
  @ApiOperation({
    summary: 'Set the exact pin',
    description:
      'Everyone else sees a point 150-300 m away (ADR-0007, ADR-0011).',
  })
  @ApiOkResponse({ type: OwnItemResponse })
  setLocation(
    @itemId() id: string,
    @Body() body: SetItemLocationBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.setLocation,
      { itemId: id, location: body.location },
      { accessToken, correlationId },
    );
  }

  @Post(':itemId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a draft (needs a location and a processed photo)',
  })
  @ApiOkResponse({ type: OwnItemResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'NOT_PUBLISHABLE, INVALID_STATE',
  })
  publish(
    @itemId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.publish,
      { itemId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':itemId/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a published item from search' })
  @ApiOkResponse({ type: OwnItemResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE',
  })
  pause(
    @itemId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.pause,
      { itemId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':itemId/unpause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show a paused item again' })
  @ApiOkResponse({ type: OwnItemResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'NOT_PUBLISHABLE, INVALID_STATE',
  })
  unpause(
    @itemId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OwnItemResponse> {
    return this.catalog.call(
      CatalogRpc.unpause,
      { itemId: id },
      { accessToken, correlationId },
    );
  }

  // --- photos (ADR-0009, ADR-0013) ----------------------------------------------

  @Post(':itemId/photos')
  @ApiOperation({
    summary: 'Start a photo upload',
    description:
      'Returns a presigned URL: PUT the file there with uploadHeaders, then confirm. At most 10 photos per item.',
  })
  @ApiCreatedResponse({ type: PhotoUploadResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'PHOTO_LIMIT_REACHED',
  })
  createPhotoUpload(
    @itemId() id: string,
    @Body() body: CreatePhotoUploadBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<PhotoUploadResponse> {
    return this.catalog.call(
      CatalogRpc.createPhotoUpload,
      { ...body, itemId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':itemId/photos/:photoId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The upload finished: process the photo',
    description: 'Poll the item until the photo is READY or FAILED.',
  })
  @ApiOkResponse({ type: PhotoViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: "INVALID_STATE (the file hasn't arrived)",
  })
  confirmPhoto(
    @itemId() id: string,
    @photoId() photo: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<PhotoViewResponse> {
    return this.catalog.call(
      CatalogRpc.confirmPhoto,
      { itemId: id, photoId: photo },
      { accessToken, correlationId },
    );
  }

  @Delete(':itemId/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a photo and its files' })
  @ApiNoContentResponse()
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: "INVALID_STATE (an active item's last processed photo)",
  })
  async deletePhoto(
    @itemId() id: string,
    @photoId() photo: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.catalog.call(
      CatalogRpc.deletePhoto,
      { itemId: id, photoId: photo },
      { accessToken, correlationId },
    );
  }

  @Put(':itemId/photos/order')
  @ApiOperation({ summary: 'Reorder photos (the first is the cover)' })
  @ApiOkResponse({ type: [PhotoViewResponse] })
  reorderPhotos(
    @itemId() id: string,
    @Body() body: ReorderPhotosBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<PhotoViewResponse[]> {
    return this.catalog.call(
      CatalogRpc.reorderPhotos,
      { itemId: id, photoIds: body.photoIds },
      { accessToken, correlationId },
    );
  }
}
