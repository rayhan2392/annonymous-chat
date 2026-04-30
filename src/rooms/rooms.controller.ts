/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  UseGuards,
  Param,
  Query,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  async createRoom(@Body('name') name: string, @Req() req: any) {
    return this.roomsService.createRoom(name, req.user.id);
  }

  @Get()
  async getRooms() {
    return this.roomsService.getAllRooms();
  }

  @Get(':id')
  async getRoom(@Param('id') id: string) {
    return this.roomsService.getRoom(id);
  }

  @Delete(':id')
  async deleteRoom(@Param('id') id: string, @Req() req: any) {
    return this.roomsService.deleteRoom(id, req.user.id);
  }

  @Get(':id/messages')
  async getRoomMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.roomsService.getRoomMessages(
      id,
      parsedLimit > 100 ? 100 : parsedLimit,
      before,
    );
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.roomsService.sendMessage(id, req.user.id, content);
  }
}
