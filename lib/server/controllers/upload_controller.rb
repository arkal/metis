class UploadController < Metis::Controller
  def authorize
    require_params(:project_name, :file_name)

    raise Etna::BadRequest, 'The filename is illegal.' unless Metis::File.valid_filename?(@params[:file_name])

    bucket_name = @params[:bucket_name] || 'files'

    bucket = Metis::Bucket.find(name: bucket_name, project_name: @params[:project_name])

    raise Etna::BadRequest, 'No such bucket!' unless bucket

    raise Etna::Forbidden, 'Inaccessible bucket.' unless bucket.allowed?(@user)

    url = Metis::File.upload_url(
      @request,
      @params[:project_name],
      bucket_name,
      @params[:file_name]
    )

    success(url)
  end

  UPLOAD_ACTIONS=[ :start, :blob, :cancel, :reset ]

  # this endpoint handles multiple possible actions, allowing us to authorize
  # one path /upload and support several upload operations
  def upload
    require_params(:project_name, :file_name, :action)

    action = @params[:action].to_sym

    raise Etna::BadRequest, 'Incorrect upload action' unless UPLOAD_ACTIONS.include?(action)

    send :"upload_#{action}"
  end

  private

  # create a metadata entry in the database and also a file on
  # the file system with 0 bytes.
  def upload_start
    require_params(:file_size, :next_blob_size, :next_blob_hash)

    # get the current bucket
    bucket = Metis::Bucket.find(name: @params[:bucket_name])

    # make an entry for the file if it does not exist
    file = Metis::File.find_or_create(
      project_name: @params[:project_name],
      file_name: @params[:file_name]
    ) do |f|
      f.original_name = @params[:file_name]
      f.uploader = ''
      f.size = 0
      f.bucket = bucket
    end

    upload = Metis::Upload.where(
      file: file,
      metis_uid: @request.cookies[Metis.instance.config(:metis_uid_name)]
    ).first

    if upload
      return success(upload.to_json, 'application/json')
    end

    raise Etna::Forbidden, 'Upload in progress' if !file.uploads.empty?

    upload = Metis::Upload.create(
      file: file,
      metis_uid: @request.cookies[Metis.instance.config(:metis_uid_name)],
      file_size: @params[:file_size].to_i,
      current_byte_position: 0,
      next_blob_size: @params[:next_blob_size],
      next_blob_hash: @params[:next_blob_hash]
    )

    # Send upload initiated
    success(upload.to_json,'application/json')
  end

  # Upload a chunk of the file.
  def upload_blob
    require_params(:blob_data, :next_blob_size, :next_blob_hash)

    file = Metis::File.find(
      project_name: @params[:project_name],
      file_name: @params[:file_name]
    )

    raise Etna::BadRequest, 'Could not find file!' unless file

    upload = Metis::Upload.where(
      file: file,
      metis_uid: @request.cookies[Metis.instance.config(:metis_uid_name)],
    ).first

    raise Etna::BadRequest, 'Upload has not been started!' unless upload

    blob_path = @params[:blob_data][:tempfile].path

    raise Etna::BadRequest, 'Blob integrity failed' unless upload.blob_valid?(blob_path)

    upload.append_blob(blob_path)

    upload.update(
      next_blob_size: @params[:next_blob_size],
      next_blob_hash: @params[:next_blob_hash]
    )

    if upload.complete?
      upload.finish!

      upload_json = upload.to_json

      upload.delete

      return success(upload_json, 'application/json')
    end

    return success(upload.to_json, 'application/json')
  end

  def upload_cancel
    file = Metis::File.find(
      project_name: @params[:project_name],
      file_name: @params[:file_name]
    )

    raise Etna::BadRequest, 'Could not find file!' unless file

    upload = Metis::Upload.where(
      file: file,
      metis_uid: @request.cookies[Metis.instance.config(:metis_uid_name)],
    ).first

    raise Etna::BadRequest, 'Upload has not been started!' unless upload

    # axe the upload data and record
    upload.delete_partial!
    upload.delete

    # axe the file if there is no data
    file.refresh
    if !file.has_data? && file.uploads.empty?
      file.delete
    end

    return success('')
  end
end
